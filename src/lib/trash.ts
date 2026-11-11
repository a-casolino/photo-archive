import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { execute, pool, query, queryOne } from "./db";
import { CARD_COLUMNS, linkedExport, treeCte, type PhotoCard } from "./gallery";
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
  const res = await execute("UPDATE photos SET deleted_at = NULL, trashed_with_album_id = NULL WHERE id IN (?)", [ids]);
  return res.affectedRows;
}

export type TrashItem = PhotoCard & { deleted_at: Date; total_size: number; days_left: number };

/**
 * Foto nel cestino, dalla più recente. Gli export collegati a un CR2 nel
 * cestino non compaiono da soli: si vedono come "versione mostrata". Le foto
 * andate nel cestino con un album si vedono sotto l'album.
 */
export async function listTrash(retentionDays: number, limit = 500): Promise<TrashItem[]> {
  // LINKED_EXPORT cerca solo export non cancellati: qui servono quelli nel cestino.
  const trashedExport = linkedExport("trashed");
  return query<TrashItem>(
    `SELECT ${CARD_COLUMNS}, p.deleted_at, p.file_size + COALESCE(x.file_size, 0) AS total_size,
            GREATEST(0, CEIL(TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), p.deleted_at + INTERVAL ? DAY) / 86400)) AS days_left
       FROM photos p
       ${trashedExport}
      WHERE p.deleted_at IS NOT NULL AND p.trashed_with_album_id IS NULL
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

export type PurgeTarget = { publicIds: string[] } | { ids: number[] } | { all: true } | { olderThanDays: number };

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
  const ids = "ids" in target ? target.ids : await expand(target.publicIds, true);
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

// ---------------------------------------------------------------------
// Album nel cestino (migrazioni 010 e 012)
// ---------------------------------------------------------------------

/** L'album e i suoi sotto-album attivi (il ramo che va nel cestino con lui). */
async function branchIds(albumId: number): Promise<number[]> {
  const rows = await query<{ id: number }>(`${treeCte("a.id = ? AND a.deleted_at IS NULL")} SELECT id FROM tree`, [
    albumId,
  ]);
  return rows.map((r) => Number(r.id));
}

/** Non sta in nessun altro album attivo fuori dal ramo. */
const ONLY_IN_BRANCH = (alias: string) => `NOT EXISTS (
  SELECT 1 FROM album_photos o JOIN albums oa ON oa.id = o.album_id AND oa.deleted_at IS NULL
   WHERE o.photo_id = ${alias}.id AND o.album_id NOT IN (?))`;

/**
 * Foto attive che andrebbero nel cestino con il ramo: quelle che non stanno
 * in nessun album fuori dal ramo, più i loro export collegati se anche loro
 * non stanno altrove. Le altre restano dove sono.
 */
async function branchOnlyPhotoIds(branch: number[]): Promise<{ ids: number[]; shown: number; elsewhere: number }> {
  if (!branch.length) return { ids: [], shown: 0, elsewhere: 0 };
  const only = await query<{ id: number }>(
    `SELECT DISTINCT p.id FROM album_photos ap JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
      WHERE ap.album_id IN (?) AND ${ONLY_IN_BRANCH("p")}`,
    [branch, branch],
  );
  const onlyIds = only.map((r) => r.id);
  const exports = onlyIds.length
    ? await query<{ id: number }>(
        `SELECT e.id FROM photos e
          WHERE e.derived_from_id IN (?) AND e.${LINKED} AND e.deleted_at IS NULL AND ${ONLY_IN_BRANCH("e")}`,
        [onlyIds, branch],
      )
    : [];
  const ids = [...new Set([...onlyIds, ...exports.map((r) => r.id)])];
  const exportIds = new Set(exports.map((r) => r.id));
  const total = await queryOne<{ n: number }>(
    `SELECT COUNT(DISTINCT p.id) AS n FROM album_photos ap JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
      WHERE ap.album_id IN (?)`,
    [branch],
  );
  // Un export che sta nel ramo insieme al suo CR2 si conta una volta sola.
  const shown = onlyIds.filter((id) => !exportIds.has(id)).length;
  return { ids, shown, elsewhere: Math.max(0, Number(total?.n ?? 0) - onlyIds.length) };
}

/**
 * Cosa andrebbe nel cestino con l'album: i sotto-album, le foto che stanno
 * solo nel ramo, e quante foto restano perché sono anche in altri album.
 */
export async function albumTrashPreview(albumId: number): Promise<{ only: number; elsewhere: number; subalbums: number }> {
  const branch = await branchIds(albumId);
  const { shown, elsewhere } = await branchOnlyPhotoIds(branch);
  return { only: shown, elsewhere, subalbums: Math.max(0, branch.length - 1) };
}

/**
 * "Elimina album": l'album, i suoi sotto-album e le foto che stanno solo lì
 * vanno nel cestino. Tutto ricorda l'album da cui è partito
 * (trashed_with_album_id), per ripristinarlo o eliminarlo insieme.
 */
export async function trashAlbum(publicId: string): Promise<{ photos: number; subalbums: number } | null> {
  const album = await queryOne<{ id: number }>("SELECT id FROM albums WHERE public_id = ? AND deleted_at IS NULL", [
    publicId,
  ]);
  if (!album) return null;
  const branch = await branchIds(album.id);
  const subalbums = branch.filter((id) => id !== album.id);
  const { ids, shown } = await branchOnlyPhotoIds(branch);
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    if (ids.length) {
      await conn.query(
        `UPDATE photos SET deleted_at = UTC_TIMESTAMP(), trashed_with_album_id = ?
          WHERE id IN (?) AND deleted_at IS NULL`,
        [album.id, ids],
      );
    }
    if (subalbums.length) {
      await conn.query(
        "UPDATE albums SET deleted_at = UTC_TIMESTAMP(), trashed_with_album_id = ? WHERE id IN (?) AND deleted_at IS NULL",
        [album.id, subalbums],
      );
    }
    await conn.query("UPDATE albums SET deleted_at = UTC_TIMESTAMP() WHERE id = ?", [album.id]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return { photos: shown, subalbums: subalbums.length };
}

/**
 * Riporta l'album con i sotto-album e le foto andati nel cestino con lui.
 * Se l'album che lo conteneva non c'è più (nel cestino o eliminato), torna
 * al primo livello.
 */
export async function restoreAlbum(publicId: string): Promise<boolean> {
  const album = await queryOne<{ id: number; parent_id: number | null }>(
    `SELECT id, parent_id FROM albums
      WHERE public_id = ? AND deleted_at IS NOT NULL AND merged_into_id IS NULL AND trashed_with_album_id IS NULL`,
    [publicId],
  );
  if (!album) return false;
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE photos SET deleted_at = NULL, trashed_with_album_id = NULL WHERE trashed_with_album_id = ?", [
      album.id,
    ]);
    await conn.query("UPDATE albums SET deleted_at = NULL, trashed_with_album_id = NULL WHERE trashed_with_album_id = ?", [
      album.id,
    ]);
    await conn.query(
      `UPDATE albums a LEFT JOIN albums parent ON parent.id = a.parent_id AND parent.deleted_at IS NULL
          SET a.deleted_at = NULL, a.parent_id = parent.id
        WHERE a.id = ?`,
      [album.id],
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return true;
}

export type TrashedAlbum = {
  id: number;
  public_id: string;
  title: string;
  deleted_at: Date;
  days_left: number;
  photos: number;
  subalbums: number;
  bytes: number;
  cover_thumb: string | null;
};

/**
 * Album eliminati (non quelli uniti a un altro, che restano per i vecchi URL,
 * né i sotto-album andati nel cestino con un album: si vedono sotto di lui).
 */
export async function listTrashedAlbums(retentionDays: number): Promise<TrashedAlbum[]> {
  return query<TrashedAlbum>(
    `SELECT a.id, a.public_id, a.title, a.deleted_at,
            GREATEST(0, CEIL(TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), a.deleted_at + INTERVAL ? DAY) / 86400)) AS days_left,
            (SELECT COUNT(*) FROM photos p WHERE p.trashed_with_album_id = a.id
                AND NOT (p.${LINKED} AND p.derived_from_id IN
                         (SELECT q.id FROM photos q WHERE q.trashed_with_album_id = a.id))) AS photos,
            (SELECT COUNT(*) FROM albums c WHERE c.trashed_with_album_id = a.id) AS subalbums,
            (SELECT COALESCE(SUM(p.file_size), 0) FROM photos p WHERE p.trashed_with_album_id = a.id) AS bytes,
            (SELECT p.gcs_thumb_key FROM photos p WHERE p.trashed_with_album_id = a.id
              ORDER BY p.id = a.cover_photo_id DESC, p.taken_at IS NULL, p.taken_at LIMIT 1) AS cover_thumb
       FROM albums a
      WHERE a.deleted_at IS NOT NULL AND a.merged_into_id IS NULL AND a.trashed_with_album_id IS NULL
      ORDER BY a.deleted_at DESC, a.id DESC`,
    [retentionDays],
  );
}

export type AlbumPurgeTarget = { publicIds: string[] } | { all: true } | { olderThanDays: number };

/**
 * Elimina definitivamente album nel cestino con le foto andate con loro
 * (file compresi). Un album con foto non cancellate dall'archivio resta nel
 * cestino, con quelle foto, per riprovare.
 */
export async function purgeAlbums(
  target: AlbumPurgeTarget,
): Promise<{ albums: number; photos: number; failed: number }> {
  const base = "deleted_at IS NOT NULL AND merged_into_id IS NULL AND trashed_with_album_id IS NULL";
  const albums =
    "all" in target
      ? await query<{ id: number }>(`SELECT id FROM albums WHERE ${base}`)
      : "olderThanDays" in target
        ? await query<{ id: number }>(
            `SELECT id FROM albums WHERE ${base} AND deleted_at < UTC_TIMESTAMP() - INTERVAL ? DAY`,
            [target.olderThanDays],
          )
        : target.publicIds.length
          ? await query<{ id: number }>(`SELECT id FROM albums WHERE ${base} AND public_id IN (?)`, [target.publicIds])
          : [];

  let done = 0;
  let photos = 0;
  let failed = 0;
  for (const { id } of albums) {
    const rows = await query<{ id: number }>("SELECT id FROM photos WHERE trashed_with_album_id = ?", [id]);
    const res = rows.length ? await purgePhotos({ ids: rows.map((r) => r.id) }) : { deleted: 0, failed: 0 };
    photos += res.deleted;
    failed += res.failed;
    if (res.failed) continue;
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();
      // Sotto-album andati nel cestino con lui, e album uniti in questi
      // (non servono più per i vecchi URL).
      const [branch] = await conn.query<RowDataPacket[]>("SELECT id FROM albums WHERE trashed_with_album_id = ?", [id]);
      const branchIds = [id, ...branch.map((r) => Number(r.id))];
      const [merged] = await conn.query<RowDataPacket[]>("SELECT id FROM albums WHERE merged_into_id IN (?)", [
        branchIds,
      ]);
      const ids = [...branchIds, ...merged.map((r) => Number(r.id))];
      // Condivisioni dell'album (destinatari e registro vanno con loro).
      await conn.query("DELETE FROM shares WHERE album_id IN (?)", [ids]);
      // Posti delle foto e tag dell'album: ON DELETE CASCADE.
      await conn.query("DELETE FROM albums WHERE id IN (?)", [ids]);
      await conn.commit();
      done++;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  return { albums: done, photos, failed };
}

// ---------------------------------------------------------------------
// Foto entrate con un import (richiesta di Antonio del 2026-11-11)
// ---------------------------------------------------------------------

/**
 * Foto entrate con l'import e ancora attive. Quelle che l'import ha trovato
 * "già presenti" appartengono all'import che le ha caricate e non contano.
 */
export async function importPhotoCount(importId: number): Promise<number> {
  const row = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM photos WHERE import_id = ? AND deleted_at IS NULL",
    [importId],
  );
  return Number(row?.n ?? 0);
}

/**
 * Sposta nel cestino le foto entrate con l'import, più gli export collegati ai
 * CR2 che ne fanno parte. Un export di questo import collegato a un CR2 di un
 * altro import va nel cestino da solo: il CR2 resta.
 */
export async function trashImportPhotos(importId: number): Promise<number> {
  const res = await execute(
    `UPDATE photos SET deleted_at = UTC_TIMESTAMP()
      WHERE deleted_at IS NULL
        AND (import_id = ?
             OR (${LINKED} AND derived_from_id IN (SELECT id FROM (SELECT id FROM photos WHERE import_id = ?) AS t)))`,
    [importId, importId],
  );
  return res.affectedRows;
}
