import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { depthOf, MAX_ALBUM_DEPTH, mergeTreeProblem, moveProblem } from "./album-tree-rules";
import { randomBase62 } from "./crypto";
import { execute, pool, query, queryOne } from "./db";
import { albumTreeIndex } from "./gallery";

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
 *   - sotto-album: quelli degli album uniti passano dentro l'album tenuto
 *     (non si può unire un album con uno che lo contiene, né superare i 3
 *     livelli);
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
  // Sotto-album: quelli degli album uniti passano a quello tenuto.
  const nodes = await albumTreeIndex();
  const byPublicId = new Map(nodes.map((n) => [n.public_id, n.id]));
  const intoNode = byPublicId.get(m.intoPublicId);
  const sourceNodes = m.sourcePublicIds.map((p) => byPublicId.get(p)).filter((id): id is number => id !== undefined);
  if (intoNode !== undefined) {
    const problem = mergeTreeProblem(intoNode, sourceNodes, nodes);
    if (problem) return { ok: false, error: problem };
  }

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

    // I link con nome seguono sempre l'album in cui si uniscono: sono indirizzi perpetui.
    await conn.query("UPDATE named_links SET album_id = ? WHERE album_id IN (?)", [into.id, sourceIds]);

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
      "UPDATE albums SET parent_id = ? WHERE parent_id IN (?) AND id NOT IN (?) AND deleted_at IS NULL",
      [into.id, sourceIds, sourceIds],
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

// ---------------------------------------------------------------------
// Sotto-album (migrazione 012)
// ---------------------------------------------------------------------

/** Nuovo album vuoto, al primo livello o dentro `parentPublicId`. */
export async function createAlbum(
  title: string,
  parentPublicId: string | null,
): Promise<{ ok: true; publicId: string } | { ok: false; error: string }> {
  let parentId: number | null = null;
  if (parentPublicId) {
    const nodes = await albumTreeIndex();
    const parent = nodes.find((n) => n.public_id === parentPublicId);
    if (!parent) return { ok: false, error: "L'album non esiste più." };
    if (depthOf(parent.id, new Map(nodes.map((n) => [n.id, n]))) >= MAX_ALBUM_DEPTH) {
      return { ok: false, error: `Qui non si possono creare sotto-album: al massimo ${MAX_ALBUM_DEPTH} livelli.` };
    }
    parentId = parent.id;
  }
  const publicId = randomBase62(22);
  await execute("INSERT INTO albums (public_id, title, origin, parent_id) VALUES (?, ?, 'manual', ?)", [
    publicId,
    title,
    parentId,
  ]);
  return { ok: true, publicId };
}

/** "Sposta in…": dentro un altro album, o al primo livello (null). */
export async function moveAlbum(
  publicId: string,
  parentPublicId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const nodes = await albumTreeIndex();
  const album = nodes.find((n) => n.public_id === publicId);
  if (!album) return { ok: false, error: "L'album non esiste più." };
  let parentId: number | null = null;
  if (parentPublicId) {
    const parent = nodes.find((n) => n.public_id === parentPublicId);
    if (!parent) return { ok: false, error: "L'album di destinazione non esiste più." };
    parentId = parent.id;
  }
  const problem = moveProblem(album.id, parentId, nodes);
  if (problem) return { ok: false, error: problem };
  await execute("UPDATE albums SET parent_id = ? WHERE id = ? AND deleted_at IS NULL", [parentId, album.id]);
  return { ok: true };
}

/**
 * "Togli dall'album": le foto escono da questo album ma restano
 * nell'archivio (e negli altri album). Un CR2 porta con sé il suo export
 * collegato, come nel cestino. Se una era la copertina, l'album torna alla
 * copertina automatica. Restituisce quante foto scelte stavano nell'album.
 */
export async function removePhotosFromAlbum(albumPublicId: string, photoPublicIds: string[]): Promise<number> {
  if (!photoPublicIds.length) return 0;
  const album = await queryOne<{ id: number }>("SELECT id FROM albums WHERE public_id = ? AND deleted_at IS NULL", [
    albumPublicId,
  ]);
  if (!album) return 0;
  const picked = await query<{ id: number }>(
    `SELECT p.id FROM photos p JOIN album_photos ap ON ap.photo_id = p.id AND ap.album_id = ?
      WHERE p.public_id IN (?)`,
    [album.id, photoPublicIds],
  );
  if (!picked.length) return 0;
  const pickedIds = picked.map((r) => r.id);
  const exports = await query<{ id: number }>(
    "SELECT id FROM photos WHERE derived_from_id IN (?) AND match_status IN ('auto', 'confirmed')",
    [pickedIds],
  );
  const ids = [...new Set([...pickedIds, ...exports.map((r) => r.id)])];
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM album_photos WHERE album_id = ? AND photo_id IN (?)", [album.id, ids]);
    await conn.query("UPDATE albums SET cover_photo_id = NULL WHERE id = ? AND cover_photo_id IN (?)", [album.id, ids]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return pickedIds.length;
}
