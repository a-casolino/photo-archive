import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool, query, queryOne } from "./db";

/*
 * Unione di album (solo proprietario: i chiamanti fanno requireOwner).
 *
 * Si sceglie un album da tenere (destinazione) e gli altri vi confluiscono:
 *   - foto: tutte nell'album tenuto, senza doppioni (una foto presente in
 *     più album compare una volta sola);
 *   - tag: l'album tenuto riceve anche i tag degli altri;
 *   - titolo: quello scelto nel form, altrimenti resta quello dell'album
 *     tenuto; descrizione e copertina dell'album tenuto, o del primo degli
 *     altri che ce l'ha se manca;
 *   - condivisioni degli album uniti: le decide Antonio ogni volta
 *     ("move" = passano all'album tenuto, chi le ha vede tutte le foto
 *     unite; "revoke" = vengono revocate). Quelle dell'album tenuto restano
 *     e da subito mostrano anche le foto arrivate;
 *   - gli album uniti vanno nel cestino (deleted_at) con merged_into_id:
 *     un nuovo import della loro cartella e i vecchi URL portano all'album
 *     tenuto. Le loro righe in album_photos restano, come traccia.
 */

const ACTIVE_SHARE = "s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > UTC_TIMESTAMP())";

export type MergeShares = "move" | "revoke";

/** Condivisioni attive (protette e link liberi) per ogni album non cancellato. */
export async function activeSharesByAlbum(): Promise<Map<number, { users: number; links: number }>> {
  const rows = await query<{ album_id: number; users: number; links: number }>(
    `SELECT s.album_id, SUM(s.mode = 'users') AS users, SUM(s.mode = 'link') AS links
       FROM shares s JOIN albums a ON a.id = s.album_id AND a.deleted_at IS NULL
      WHERE s.target_type = 'album' AND ${ACTIVE_SHARE}
      GROUP BY s.album_id`,
  );
  return new Map(rows.map((r) => [Number(r.album_id), { users: Number(r.users), links: Number(r.links) }]));
}

/** Album in cui è confluito un album unito (per i vecchi URL). */
export async function mergedInto(publicId: string): Promise<string | null> {
  if (!/^[0-9A-Za-z]{22}$/.test(publicId)) return null;
  const row = await queryOne<{ public_id: string }>(
    `SELECT m.public_id FROM albums a JOIN albums m ON m.id = a.merged_into_id AND m.deleted_at IS NULL
      WHERE a.public_id = ? AND a.deleted_at IS NOT NULL`,
    [publicId],
  );
  return row?.public_id ?? null;
}

type AlbumLock = RowDataPacket & {
  id: number;
  public_id: string;
  title: string;
  description: string | null;
  cover_photo_id: number | null;
};

export type MergeResult =
  | { ok: true; intoPublicId: string; merged: number; photosAdded: number; sharesMoved: number; sharesRevoked: number }
  | { ok: false; error: string; needsShareChoice?: boolean };

export async function mergeAlbums(m: {
  intoPublicId: string;
  sourcePublicIds: string[];
  title: string | null;
  shares: MergeShares | null;
}): Promise<MergeResult> {
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    const ids = [m.intoPublicId, ...m.sourcePublicIds];
    const [rows] = await conn.query<AlbumLock[]>(
      `SELECT id, public_id, title, description, cover_photo_id FROM albums
        WHERE public_id IN (?) AND deleted_at IS NULL FOR UPDATE`,
      [ids],
    );
    const byPublic = new Map(rows.map((r) => [r.public_id, r]));
    const into = byPublic.get(m.intoPublicId);
    // Ordine delle partenze come nel form (conta per descrizione e copertina).
    const sources = m.sourcePublicIds.map((p) => byPublic.get(p)).filter((r): r is AlbumLock => !!r);
    if (!into || sources.length !== m.sourcePublicIds.length) {
      await conn.rollback();
      return { ok: false, error: "Uno degli album non esiste più (forse è già stato unito). Ricarica la pagina." };
    }
    const sourceIds = sources.map((s) => s.id);

    const [[shareCount]] = await conn.query<(RowDataPacket & { n: number })[]>(
      `SELECT COUNT(*) AS n FROM shares s WHERE s.album_id IN (?) AND ${ACTIVE_SHARE}`,
      [sourceIds],
    );
    const activeShares = Number(shareCount?.n ?? 0);
    if (activeShares > 0 && !m.shares) {
      await conn.rollback();
      return {
        ok: false,
        needsShareChoice: true,
        error: "Gli album da unire hanno condivisioni attive: scegli se spostarle o revocarle.",
      };
    }

    const [photos] = await conn.query<ResultSetHeader>(
      `INSERT IGNORE INTO album_photos (album_id, photo_id, position, added_at)
       SELECT ?, ap.photo_id, MIN(ap.position), MIN(ap.added_at)
         FROM album_photos ap WHERE ap.album_id IN (?)
        GROUP BY ap.photo_id`,
      [into.id, sourceIds],
    );

    await conn.query(
      `INSERT IGNORE INTO album_tags (album_id, tag_id, added_at)
       SELECT ?, at.tag_id, MIN(at.added_at) FROM album_tags at WHERE at.album_id IN (?) GROUP BY at.tag_id`,
      [into.id, sourceIds],
    );

    let sharesMoved = 0;
    let sharesRevoked = 0;
    if (m.shares === "move") {
      // Anche quelle scadute o revocate, così lo storico resta in un posto solo.
      const [res] = await conn.query<ResultSetHeader>(
        "UPDATE shares SET album_id = ? WHERE album_id IN (?)",
        [into.id, sourceIds],
      );
      sharesMoved = res.affectedRows;
    } else if (m.shares === "revoke") {
      const [res] = await conn.query<ResultSetHeader>(
        "UPDATE shares SET revoked_at = UTC_TIMESTAMP() WHERE album_id IN (?) AND revoked_at IS NULL",
        [sourceIds],
      );
      sharesRevoked = res.affectedRows;
    }

    const description = into.description ?? sources.find((s) => s.description)?.description ?? null;
    const cover = into.cover_photo_id ?? sources.find((s) => s.cover_photo_id)?.cover_photo_id ?? null;
    await conn.query(
      `UPDATE albums a
         LEFT JOIN (SELECT MIN(DATE(p.taken_at)) d1, MAX(DATE(p.taken_at)) d2
                      FROM album_photos ap JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
                     WHERE ap.album_id = ?) x ON TRUE
          SET a.title = ?, a.description = ?, a.cover_photo_id = ?, a.date_from = x.d1, a.date_to = x.d2
        WHERE a.id = ?`,
      [into.id, m.title || into.title, description, cover, into.id],
    );

    await conn.query(
      "UPDATE albums SET deleted_at = UTC_TIMESTAMP(), merged_into_id = ? WHERE id IN (?)",
      [into.id, sourceIds],
    );
    // Un solo passaggio: chi era già confluito in un album unito adesso punta alla destinazione.
    await conn.query("UPDATE albums SET merged_into_id = ? WHERE merged_into_id IN (?)", [into.id, sourceIds]);

    await conn.commit();
    return {
      ok: true,
      intoPublicId: into.public_id,
      merged: sources.length,
      photosAdded: photos.affectedRows,
      sharesMoved,
      sharesRevoked,
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
