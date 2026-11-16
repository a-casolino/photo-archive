import "server-only";
import {
  BACKUP_ROOT_TITLE,
  folderSections,
  looseYearTitle,
  promotedTitle,
  proposePairs,
  shotKey,
  type AlbumVotes,
} from "./album-pair-rules";
import { mergeAlbums } from "./albums";
import { execute, query } from "./db";

/*
 * Calcolo delle coppie album Google ↔ cartella del disco (vedi
 * album-pair-rules.ts). Le righe si leggono una volta e si confrontano in
 * memoria: niente join pesanti su MySQL. Le decisioni già prese (confermata,
 * scartata) restano; le proposte si aggiornano.
 */

type Row = { album_id: number; photo_id: number; camera_id: number | null; taken_at: Date | null; raw_id: number | null };

export async function computeAlbumPairs(): Promise<{ proposed: number; albums: number }> {
  const [googleRows, folderRows] = await Promise.all([
    query<Row>(
      `SELECT ap.album_id, p.id AS photo_id, p.camera_id, p.taken_at, p.derived_from_id AS raw_id
         FROM albums a
         JOIN album_photos ap ON ap.album_id = a.id
         JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
        WHERE a.origin = 'google_photos' AND a.parent_id IS NULL AND a.deleted_at IS NULL
          AND ap.section = 'main'`,
    ),
    // Le cartelle del disco sotto il primo livello ("Backup Foto" › anno › giorno).
    query<Row>(
      `SELECT ap.album_id, p.id AS photo_id, p.camera_id, p.taken_at, NULL AS raw_id
         FROM albums a
         JOIN album_photos ap ON ap.album_id = a.id
         JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
        WHERE a.origin = 'disk_folder' AND a.parent_id IS NOT NULL AND a.deleted_at IS NULL`,
    ),
  ]);

  const foldersOfPhoto = new Map<number, number[]>();
  const foldersOfShot = new Map<string, number[]>();
  for (const r of folderRows) {
    const folder = Number(r.album_id);
    const pid = Number(r.photo_id);
    foldersOfPhoto.set(pid, [...(foldersOfPhoto.get(pid) ?? []), folder]);
    const k = shotKey(r.camera_id, r.taken_at);
    if (k) foldersOfShot.set(k, [...(foldersOfShot.get(k) ?? []), folder]);
  }

  const byAlbum = new Map<number, AlbumVotes>();
  for (const r of googleRows) {
    const id = Number(r.album_id);
    const a = byAlbum.get(id) ?? { albumId: id, photos: 0, folders: [] as number[][] };
    a.photos++;
    const k = shotKey(r.camera_id, r.taken_at);
    (a.folders as number[][]).push([
      ...(foldersOfPhoto.get(Number(r.photo_id)) ?? []),
      ...(r.raw_id ? (foldersOfPhoto.get(Number(r.raw_id)) ?? []) : []),
      ...(k ? (foldersOfShot.get(k) ?? []) : []),
    ]);
    byAlbum.set(id, a);
  }

  // Una cartella già confermata con un album non si propone per un altro.
  const confirmed = await query<{ google_album_id: number; folder_album_id: number }>(
    "SELECT google_album_id, folder_album_id FROM album_pairs WHERE status = 'confirmed'",
  );
  const owner = new Map(confirmed.map((c) => [Number(c.folder_album_id), Number(c.google_album_id)]));
  const pairs = proposePairs([...byAlbum.values()]).filter(
    (p) => !owner.has(p.folderId) || owner.get(p.folderId) === p.googleId,
  );

  await execute("DELETE FROM album_pairs WHERE status = 'proposed'");
  for (let i = 0; i < pairs.length; i += 500) {
    const chunk = pairs.slice(i, i + 500);
    await execute(
      `INSERT INTO album_pairs (google_album_id, folder_album_id, shared_photos, album_photos)
       VALUES ${chunk.map(() => "(?, ?, ?, ?)").join(", ")}
       ON DUPLICATE KEY UPDATE shared_photos = VALUES(shared_photos), album_photos = VALUES(album_photos),
                               computed_at = UTC_TIMESTAMP()`,
      chunk.flatMap((p) => [p.googleId, p.folderId, p.shared, p.photos]),
    );
  }
  return { proposed: pairs.length, albums: new Set(pairs.map((p) => p.googleId)).size };
}

// ---------------------------------------------------------------------
// Unione (passo 3): album Google + cartelle confermate
// ---------------------------------------------------------------------

type PhotoRow = { id: number; kind: string; camera_id: number | null; taken_at: Date | null; raw_id: number | null };

/**
 * Unisce all'album Google le sue cartelle confermate e non ancora unite
 * (richiesta di Antonio del 2026-11-16: due gruppi soli). Le foto della
 * cartella che stanno dietro a un export dell'album (CR2 collegato o stesso
 * scatto) non entrano: si aprono dal link al RAW; gli export ancora senza CR2
 * con un solo CR2 dello stesso scatto nella cartella si collegano. Le altre
 * entrano come 'extra' ("Altri scatti"). Le cartelle vanno nel cestino con
 * merged_into_id (vedi mergeAlbums).
 */
export async function mergeAlbumPair(googlePublicId: string): Promise<{ ok: true; folders: number } | { ok: false; error: string }> {
  const rows = await query<{ g: number; f: number; f_pid: string }>(
    `SELECT ap.google_album_id AS g, ap.folder_album_id AS f, fa.public_id AS f_pid
       FROM album_pairs ap
       JOIN albums ga ON ga.id = ap.google_album_id AND ga.public_id = ? AND ga.deleted_at IS NULL
       JOIN albums fa ON fa.id = ap.folder_album_id AND fa.deleted_at IS NULL
      WHERE ap.status = 'confirmed' AND ap.merged_at IS NULL`,
    [googlePublicId],
  );
  if (!rows.length) return { ok: false, error: "Nessuna cartella confermata da unire a questo album." };
  const googleId = Number(rows[0].g);
  const folderIds = rows.map((r) => Number(r.f));

  const photoSql = `SELECT p.id, p.kind, p.camera_id, p.taken_at, p.derived_from_id AS raw_id
                      FROM album_photos ap JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
                     WHERE ap.album_id IN (?)`;
  const [inAlbum, inFolders] = await Promise.all([
    query<PhotoRow>(photoSql, [[googleId]]),
    query<PhotoRow>(photoSql, [folderIds]),
  ]);
  const sections = folderSections(inAlbum, inFolders);

  const res = await mergeAlbums({
    intoPublicId: googlePublicId,
    sourcePublicIds: rows.map((r) => r.f_pid),
    title: null,
    shares: "move",
  });
  if (!res.ok) return { ok: false, error: res.error };

  for (let i = 0; i < sections.behind.length; i += 1000) {
    await execute("DELETE FROM album_photos WHERE album_id = ? AND photo_id IN (?)", [
      googleId,
      sections.behind.slice(i, i + 1000),
    ]);
  }
  for (let i = 0; i < sections.extra.length; i += 1000) {
    await execute("UPDATE album_photos SET section = 'extra' WHERE album_id = ? AND photo_id IN (?)", [
      googleId,
      sections.extra.slice(i, i + 1000),
    ]);
  }
  for (const l of sections.links) {
    await execute(
      `UPDATE photos SET kind = 'edit', derived_from_id = ?, match_status = 'confirmed', match_method = 'datetime'
        WHERE id = ? AND derived_from_id IS NULL AND match_status = 'none' AND deleted_at IS NULL`,
      [l.rawId, l.exportId],
    );
  }
  await execute(
    "UPDATE album_pairs SET merged_at = UTC_TIMESTAMP() WHERE google_album_id = ? AND folder_album_id IN (?)",
    [googleId, folderIds],
  );
  return { ok: true, folders: folderIds.length };
}

// ---------------------------------------------------------------------
// Cartelle di Backup Foto senza album Google → primo livello
// ---------------------------------------------------------------------

type TreeRow = { id: number; parent_id: number | null; title: string; photos: number; pending: number };

/**
 * Le cartelle di Backup Foto (anno › giorno) senza album Google diventano
 * album di primo livello con la data nel titolo (scelta di Antonio del
 * 2026-11-16); un anno con foto sue diventa "AAAA (foto senza cartella)".
 * Le cartelle confermate e non ancora unite restano dove sono (vanno unite
 * prima). Anni e Backup Foto rimasti vuoti vanno nel cestino.
 */
export async function backupFoldersLeft(): Promise<{ roots: TreeRow[]; years: TreeRow[]; days: TreeRow[] }> {
  const rows = await query<TreeRow>(
    `SELECT a.id, a.parent_id, a.title,
            (SELECT COUNT(*) FROM album_photos ap JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
              WHERE ap.album_id = a.id) AS photos,
            EXISTS (SELECT 1 FROM album_pairs x WHERE x.folder_album_id = a.id AND x.status = 'confirmed'
                       AND x.merged_at IS NULL) AS pending
       FROM albums a WHERE a.origin = 'disk_folder' AND a.deleted_at IS NULL`,
  );
  const roots = rows.filter((r) => r.parent_id === null && BACKUP_ROOT_TITLE.test(r.title.trim()));
  const rootIds = new Set(roots.map((r) => Number(r.id)));
  const years = rows.filter((r) => r.parent_id !== null && rootIds.has(Number(r.parent_id)));
  const yearIds = new Set(years.map((r) => Number(r.id)));
  const days = rows.filter((r) => r.parent_id !== null && yearIds.has(Number(r.parent_id)));
  return { roots, years, days };
}

export async function promoteBackupFolders(): Promise<{ promoted: number; trashed: number; waiting: number }> {
  const { roots, years, days } = await backupFoldersLeft();
  const yearTitle = new Map(years.map((y) => [Number(y.id), y.title]));
  let promoted = 0, trashed = 0, waiting = 0;
  const stays = new Set<number>(); // anni che contengono ancora cartelle da unire

  for (const d of days) {
    if (Number(d.pending)) {
      waiting++;
      stays.add(Number(d.parent_id));
      continue;
    }
    // Una cartella vuota (es. dopo un'unione fallita a metà) non si porta su: va nel cestino con l'anno.
    if (!Number(d.photos)) continue;
    await execute("UPDATE albums SET parent_id = NULL, title = ? WHERE id = ?", [
      promotedTitle(yearTitle.get(Number(d.parent_id)) ?? null, d.title),
      d.id,
    ]);
    promoted++;
  }
  for (const y of years) {
    if (stays.has(Number(y.id))) continue;
    if (Number(y.pending)) {
      waiting++;
      continue;
    }
    if (Number(y.photos)) {
      // Dentro restano solo cartelle vuote (quelle con foto sono già al primo livello): nel cestino.
      const res = await execute("UPDATE albums SET deleted_at = UTC_TIMESTAMP() WHERE parent_id = ? AND deleted_at IS NULL", [
        y.id,
      ]);
      trashed += res.affectedRows;
      await execute("UPDATE albums SET parent_id = NULL, title = ? WHERE id = ?", [looseYearTitle(y.title), y.id]);
      promoted++;
    } else {
      const res = await execute(
        `UPDATE albums SET deleted_at = UTC_TIMESTAMP(), trashed_with_album_id = IF(id = ?, NULL, ?)
          WHERE (id = ? OR parent_id = ?) AND deleted_at IS NULL`,
        [y.id, y.id, y.id, y.id],
      );
      trashed += res.affectedRows;
    }
  }
  for (const r of roots) {
    const [left] = await query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM albums WHERE parent_id = ? AND deleted_at IS NULL",
      [r.id],
    );
    if (!Number(left?.n) && !Number(r.photos)) {
      await execute("UPDATE albums SET deleted_at = UTC_TIMESTAMP() WHERE id = ?", [r.id]);
      trashed++;
    }
  }
  return { promoted, trashed, waiting };
}
