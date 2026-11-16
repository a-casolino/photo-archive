import "server-only";
import { execute, query } from "./db";
import { proposePairs, shotKey, type AlbumVotes } from "./album-pair-rules";

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
        WHERE a.origin = 'google_photos' AND a.parent_id IS NULL AND a.deleted_at IS NULL`,
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
