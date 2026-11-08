import "server-only";
import { execute, pool, query, queryOne } from "./db";
import { CARD_COLUMNS, LINKED_EXPORT, type PhotoCard } from "./gallery";
import { storage } from "./storage";
import { runLimited, storageKeysOf, type PurgeRow } from "./trash-rules";

/*
 * Cestino delle foto (richiesta di Antonio del 2026-11-08).
 *
 * - "Sposta nel cestino" imposta photos.deleted_at: la foto sparisce da album,
 *   tag, persone e condivisioni, ma si può ripristinare.
 * - "Elimina definitivamente" cancella i file dall'archivio (CR2, anteprima,
 *   miniatura, miniature dei volti) e poi le righe nel database: volti, tag,
 *   posti negli album e condivisioni della sola foto se ne vanno con lei.
 *
 * Un CR2 e il suo export di Lightroom collegato (match 'auto' o 'confirmed')
 * nell'app sono la stessa foto: vanno nel cestino, tornano e si eliminano
 * insieme. Nel cestino si vede solo il CR2.
 *
 * Prima i file, poi il database: se l'archivio non risponde la foto resta nel
 * cestino e si può riprovare, invece di lasciare file orfani nel bucket.
 */

const LINKED = "match_status IN ('auto', 'confirmed')";

/** Id delle foto indicate più i loro export collegati, nello stato voluto. */
async function expand(publicIds: string[], trashed: boolean): Promise<number[]> {
  if (!publicIds.length) return [];
  const state = trashed ? "deleted_at IS NOT NULL" : "deleted_at IS NULL";
  const rows = await query<{ id: number }>(
    `SELECT id FROM photos WHERE public_id IN (?) AND ${state}
     UNION
     SELECT e.id FROM photos e JOIN photos p ON p.id = e.derived_from_id
      WHERE p.public_id IN (?) AND e.${LINKED} AND e.${state}`,
    [publicIds, publicIds],
  );
  return rows.map((r) => r.id);
}

/** Sposta le foto nel cestino. Restituisce quante righe ha toccato. */
export async function trashPhotos(publicIds: string[]): Promise<number> {
  const ids = await expand(publicIds, false);
  if (!ids.length) return 0;
  const res = await execute("UPDATE photos SET deleted_at = UTC_TIMESTAMP() WHERE id IN (?) AND deleted_at IS NULL", [
    ids,
  ]);
  return res.affectedRows;
}

/** Riporta le foto dal cestino. */
export async function restorePhotos(publicIds: string[]): Promise<number> {
  const ids = await expand(publicIds, true);
  if (!ids.length) return 0;
  const res = await execute("UPDATE photos SET deleted_at = NULL WHERE id IN (?)", [ids]);
  return res.affectedRows;
}

export type TrashItem = PhotoCard & { deleted_at: Date; total_size: number; days_left: number };

/**
 * Foto nel cestino, dalla più recente. Gli export collegati a un CR2 nel
 * cestino non compaiono da soli: si vedono come "versione mostrata".
 */
export async function listTrash(retentionDays: number, limit = 500): Promise<TrashItem[]> {
  // LINKED_EXPORT cerca solo export non cancellati: qui servono quelli nel cestino.
  const trashedExport = LINKED_EXPORT.replace("e.deleted_at IS NULL", "e.deleted_at IS NOT NULL");
  return query<TrashItem>(
    `SELECT ${CARD_COLUMNS}, p.deleted_at, p.file_size + COALESCE(x.file_size, 0) AS total_size,
            GREATEST(0, CEIL(TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), p.deleted_at + INTERVAL ? DAY) / 86400)) AS days_left
       FROM photos p
       ${trashedExport}
      WHERE p.deleted_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM photos d
                         WHERE d.id = p.derived_from_id AND p.${LINKED} AND d.deleted_at IS NOT NULL)
      ORDER BY p.deleted_at DESC, p.id DESC
      LIMIT ?`,
    [retentionDays, limit],
  );
}

export async function trashSummary(): Promise<{ photos: number; bytes: number; archiveBytes: number }> {
  const row = await queryOne<{ photos: number; bytes: number | null; archive: number | null }>(
    `SELECT COUNT(*) AS photos, SUM(file_size) AS bytes,
            SUM(IF(gcs_original_class = 'ARCHIVE', file_size, 0)) AS archive
       FROM photos WHERE deleted_at IS NOT NULL`,
  );
  return { photos: Number(row?.photos ?? 0), bytes: Number(row?.bytes ?? 0), archiveBytes: Number(row?.archive ?? 0) };
}

export type PurgeTarget = { publicIds: string[] } | { all: true } | { olderThanDays: number };

type PurgeCandidate = PurgeRow & { parent_id: number | null };

const PURGE_COLUMNS = `id, gcs_original_key AS original_key, gcs_preview_key AS preview_key,
  gcs_thumb_key AS thumb_key, IF(${LINKED}, derived_from_id, NULL) AS parent_id`;

async function purgeCandidates(target: PurgeTarget): Promise<PurgeCandidate[]> {
  if ("all" in target) {
    return query<PurgeCandidate>(`SELECT ${PURGE_COLUMNS} FROM photos WHERE deleted_at IS NOT NULL`);
  }
  if ("olderThanDays" in target) {
    // Un export segue il suo CR2: conta la data del CR2 se è nel cestino.
    return query<PurgeCandidate>(
      `SELECT ${PURGE_COLUMNS} FROM photos p
        WHERE p.deleted_at IS NOT NULL
          AND COALESCE(
                (SELECT d.deleted_at FROM photos d
                  WHERE d.id = p.derived_from_id AND p.${LINKED} AND d.deleted_at IS NOT NULL),
                p.deleted_at) < UTC_TIMESTAMP() - INTERVAL ? DAY`,
      [target.olderThanDays],
    );
  }
  const ids = await expand(target.publicIds, true);
  if (!ids.length) return [];
  return query<PurgeCandidate>(`SELECT ${PURGE_COLUMNS} FROM photos WHERE id IN (?) AND deleted_at IS NOT NULL`, [ids]);
}

/**
 * Elimina definitivamente foto già nel cestino: le indicate, tutte, o quelle
 * nel cestino da più di N giorni. Restituisce quante foto sono state
 * eliminate e quante no (archivio non raggiungibile: restano nel cestino).
 */
export async function purgePhotos(target: PurgeTarget): Promise<{ deleted: number; failed: number }> {
  const rows = await purgeCandidates(target);
  if (!rows.length) return { deleted: 0, failed: 0 };

  const faces = await query<{ photo_id: number; face_key: string | null }>(
    "SELECT photo_id, gcs_face_key AS face_key FROM faces WHERE photo_id IN (?)",
    [rows.map((r) => r.id)],
  );
  const faceKeys = new Map<number, string[]>();
  for (const f of faces) if (f.face_key) faceKeys.set(f.photo_id, [...(faceKeys.get(f.photo_id) ?? []), f.face_key]);

  // 1. File dall'archivio, qualche richiesta alla volta.
  const s = storage();
  const work = rows.flatMap((r) => storageKeysOf(r, faceKeys.get(r.id)).map((key) => ({ id: r.id, key })));
  const failures = await runLimited(work, 8, ({ key }) => s.remove(key));
  for (const f of failures) console.error(`[cestino] ${f.item.key} non cancellato:`, f.error);
  const failedIds = new Set(failures.map((f) => f.item.id));
  const done = rows.map((r) => r.id).filter((id) => !failedIds.has(id));

  // 2. Database, tutto insieme o niente.
  if (done.length) {
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();
      // Condivisioni della sola foto (destinatari e registro vanno con loro).
      await conn.query("DELETE FROM shares WHERE photo_id IN (?)", [done]);
      // Il registro delle condivisioni di album tiene l'evento, senza la foto.
      await conn.query("UPDATE share_events SET photo_id = NULL WHERE photo_id IN (?)", [done]);
      // Volti, tag, album_photos, doppioni scartati: ON DELETE CASCADE.
      // Copertine e legami export -> CR2: ON DELETE SET NULL.
      await conn.query("DELETE FROM photos WHERE id IN (?)", [done]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  // Conto le foto come le vede Antonio: un CR2 e il suo export sono una.
  const all = new Set(rows.map((r) => r.id));
  const shown = (ids: Iterable<number>) => {
    const set = new Set(ids);
    return rows.filter((r) => set.has(r.id) && !(r.parent_id && all.has(r.parent_id))).length;
  };
  return { deleted: shown(done), failed: shown(failedIds) };
}
