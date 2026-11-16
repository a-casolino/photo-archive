import "server-only";
import { folderSections, proposePairs, shotKey, type AlbumVotes } from "./album-pair-rules";
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
 * Unisce all'album Google le sue cartelle confermate e non ancora unite.
 * Le foto della cartella entrano come 'source' se stanno dietro a un export
 * dell'album (CR2 collegato, oppure stessa fotocamera e stesso istante),
 * altrimenti come 'extra' ("Altri scatti"). Le condivisioni delle cartelle
 * passano all'album; le cartelle vanno nel cestino con merged_into_id
 * (vedi mergeAlbums).
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

  for (const section of ["source", "extra"] as const) {
    const ids = sections[section];
    for (let i = 0; i < ids.length; i += 1000) {
      await execute(
        "UPDATE album_photos SET section = ? WHERE album_id = ? AND photo_id IN (?) AND section = 'main'",
        [section, googleId, ids.slice(i, i + 1000)],
      );
    }
  }
  await execute(
    "UPDATE album_pairs SET merged_at = UTC_TIMESTAMP() WHERE google_album_id = ? AND folder_album_id IN (?)",
    [googleId, folderIds],
  );
  return { ok: true, folders: folderIds.length };
}
