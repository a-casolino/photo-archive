import "server-only";
import {
  BACKUP_ROOT_TITLE,
  HashIndex,
  eventSides,
  cameraGroups,
  folderSections,
  hashOf,
  looseYearTitle,
  promotedTitle,
  proposePairs,
  shotKey,
  type AlbumVotes,
} from "./album-pair-rules";
import { mergeAlbums } from "./albums";
import { execute, query } from "./db";
import type { Hash } from "./phash-rules";

/*
 * Calcolo delle coppie album Google ↔ cartella del disco (vedi
 * album-pair-rules.ts). Le righe si leggono una volta e si confrontano in
 * memoria: niente join pesanti su MySQL. Le decisioni già prese (confermata,
 * scartata) restano; le proposte si aggiornano.
 */

type Row = {
  album_id: number;
  photo_id: number;
  camera_id: number | null;
  taken_at: Date | null;
  raw_id: number | null;
  phash: string | null;
};

/** Fotocamere senza distinzione di numero di serie (vedi cameraGroups). */
async function cameraIds(): Promise<(id: number | null) => number | null> {
  const groups = cameraGroups(await query<{ id: number; make: string; model: string }>("SELECT id, make, model FROM cameras"));
  return (id) => (id ? (groups.get(Number(id)) ?? Number(id)) : null);
}

export async function computeAlbumPairs(): Promise<{ proposed: number; albums: number }> {
  const [googleRows, folderRows, camera] = await Promise.all([
    query<Row>(
      `SELECT ap.album_id, p.id AS photo_id, p.camera_id, p.taken_at, p.derived_from_id AS raw_id, p.phash
         FROM albums a
         JOIN album_photos ap ON ap.album_id = a.id
         JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
        WHERE a.origin = 'google_photos' AND a.parent_id IS NULL AND a.deleted_at IS NULL
          AND ap.section = 'main'`,
    ),
    // Le cartelle del disco: quelle ancora sotto "Backup Foto" e quelle già
    // portate al primo livello (2026-11-20: le cartelle di soli JPEG non erano
    // state riconosciute e sono finite al primo livello accanto al loro album).
    query<Row>(
      `SELECT ap.album_id, p.id AS photo_id, p.camera_id, p.taken_at, NULL AS raw_id, p.phash
         FROM albums a
         JOIN album_photos ap ON ap.album_id = a.id
         JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
        WHERE a.origin = 'disk_folder' AND a.deleted_at IS NULL`,
    ),
    cameraIds(),
  ]);

  const foldersOfPhoto = new Map<number, number[]>();
  const foldersOfShot = new Map<string, number[]>();
  const index = new HashIndex<{ id: number; hash: Hash }>();
  for (const r of folderRows) {
    const folder = Number(r.album_id);
    const pid = Number(r.photo_id);
    if (!foldersOfPhoto.has(pid)) {
      const h = hashOf(r.phash);
      if (h) index.add({ id: pid, hash: h });
    }
    foldersOfPhoto.set(pid, [...(foldersOfPhoto.get(pid) ?? []), folder]);
    const k = shotKey(camera(r.camera_id), r.taken_at);
    if (k) foldersOfShot.set(k, [...(foldersOfShot.get(k) ?? []), folder]);
  }

  const byAlbum = new Map<number, AlbumVotes>();
  for (const r of googleRows) {
    const id = Number(r.album_id);
    const a = byAlbum.get(id) ?? { albumId: id, photos: 0, folders: [] as number[][] };
    a.photos++;
    const k = shotKey(camera(r.camera_id), r.taken_at);
    const folders = [
      ...(foldersOfPhoto.get(Number(r.photo_id)) ?? []),
      ...(r.raw_id ? (foldersOfPhoto.get(Number(r.raw_id)) ?? []) : []),
      ...(k ? (foldersOfShot.get(k) ?? []) : []),
    ];
    // Senza dati della fotocamera (copie di Google Foto senza EXIF): la stessa immagine.
    if (!folders.length && !k) {
      const h = hashOf(r.phash);
      const twin = h ? index.nearest(h) : null;
      if (twin) folders.push(...(foldersOfPhoto.get(twin.id) ?? []));
    }
    (a.folders as number[][]).push(folders);
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

type PhotoRow = {
  id: number;
  kind: string;
  camera_id: number | null;
  taken_at: Date | null;
  raw_id: number | null;
  phash: string | null;
  name: string | null;
};

const PHOTO_COLUMNS =
  "p.id, p.kind, p.camera_id, p.taken_at, p.derived_from_id AS raw_id, p.phash, p.original_filename AS name";

/** Applica all'album le sezioni calcolate da folderSections. */
async function applySections(albumId: number, sections: ReturnType<typeof folderSections>): Promise<void> {
  const chunks = (ids: number[]) =>
    Array.from({ length: Math.ceil(ids.length / 1000) }, (_, i) => ids.slice(i * 1000, i * 1000 + 1000));
  for (const c of chunks(sections.behind)) {
    await execute("DELETE FROM album_photos WHERE album_id = ? AND photo_id IN (?)", [albumId, c]);
  }
  for (const c of chunks(sections.extra)) {
    await execute("UPDATE album_photos SET section = 'extra' WHERE album_id = ? AND photo_id IN (?)", [albumId, c]);
  }
  for (const c of chunks(sections.main)) {
    await execute("UPDATE album_photos SET section = 'main' WHERE album_id = ? AND photo_id IN (?)", [albumId, c]);
  }
  for (const l of sections.links) {
    await execute(
      `UPDATE photos SET kind = 'edit', derived_from_id = ?, match_status = 'confirmed', match_method = 'album'
        WHERE id = ? AND derived_from_id IS NULL AND match_status = 'none' AND deleted_at IS NULL`,
      [l.rawId, l.exportId],
    );
  }
}

/**
 * Unisce all'album Google le sue cartelle confermate e non ancora unite
 * (richiesta di Antonio del 2026-11-16: due gruppi soli). Le foto della
 * cartella che stanno dietro a un export dell'album (vedi folderSections) non
 * entrano: si aprono dal link all'originale; gli export ancora senza originale
 * si collegano; gli export della cartella vanno in primo piano. Le altre
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

  const photoSql = `SELECT ${PHOTO_COLUMNS}
                      FROM album_photos ap JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
                     WHERE ap.album_id IN (?)`;
  const [inAlbum, inFolders, camera] = await Promise.all([
    query<PhotoRow>(photoSql, [[googleId]]),
    query<PhotoRow>(photoSql, [folderIds]),
    cameraIds(),
  ]);
  const same = (p: PhotoRow) => ({ ...p, camera_id: camera(p.camera_id) });
  const sections = folderSections(inAlbum.map(same), inFolders.map(same));

  const res = await mergeAlbums({
    intoPublicId: googlePublicId,
    sourcePublicIds: rows.map((r) => r.f_pid),
    title: null,
    shares: "move",
  });
  if (!res.ok) return { ok: false, error: res.error };

  await applySections(googleId, sections);
  await execute(
    "UPDATE album_pairs SET merged_at = UTC_TIMESTAMP() WHERE google_album_id = ? AND folder_album_id IN (?)",
    [googleId, folderIds],
  );
  return { ok: true, folders: folderIds.length };
}

/**
 * Riordina gli album già uniti (2026-11-20) e quelli degli eventi: ricalcola gli "Altri scatti"
 * rispetto alle foto in primo piano con le regole di oggi (nome del file,
 * fotocamera senza numero di serie, impronta visiva). Gli scatti che stanno
 * dietro a un export escono dall'album, gli export della cartella passano in
 * primo piano, gli export senza originale si collegano. Due query per tutti
 * gli album, il confronto in memoria. Con dryRun non cambia niente: serve
 * per l'anteprima.
 */
export type TidyAlbum = { id: number; public_id: string; title: string; behind: number; main: number; links: number };

export async function tidyMergedAlbums(opts: { dryRun?: boolean } = {}): Promise<TidyAlbum[]> {
  const [rows, camera] = await Promise.all([
    query<PhotoRow & { album_id: number; section: "main" | "extra"; album_pid: string; album_title: string }>(
      `SELECT ap.album_id, ap.section, a.public_id AS album_pid, a.title AS album_title, ${PHOTO_COLUMNS}
         FROM album_photos ap
         JOIN albums a ON a.id = ap.album_id AND a.deleted_at IS NULL
         JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
        -- Gli album con "Altri scatti": quelli uniti e quelli degli eventi (--evento).
        WHERE ap.album_id IN (SELECT album_id FROM album_photos WHERE section = 'extra')`,
    ),
    cameraIds(),
  ]);
  const byAlbum = new Map<number, { pid: string; title: string; main: PhotoRow[]; extra: PhotoRow[] }>();
  for (const r of rows) {
    const a = byAlbum.get(Number(r.album_id)) ?? { pid: r.album_pid, title: r.album_title, main: [], extra: [] };
    a[r.section === "extra" ? "extra" : "main"].push({ ...r, camera_id: camera(r.camera_id) });
    byAlbum.set(Number(r.album_id), a);
  }
  const out: TidyAlbum[] = [];
  for (const [albumId, a] of byAlbum) {
    if (!a.extra.length) continue;
    const s = folderSections(a.main, a.extra);
    if (!s.behind.length && !s.main.length && !s.links.length) continue;
    // Quelle che restano negli Altri scatti sono già lì.
    if (!opts.dryRun) await applySections(albumId, { ...s, extra: [] });
    out.push({ id: albumId, public_id: a.pid, title: a.title, behind: s.behind.length, main: s.main.length, links: s.links.length });
  }
  return out.sort((x, y) => x.title.localeCompare(y.title, "it"));
}

/**
 * Sistema l'album di un evento appena importato (`--evento`, 2026-11-21):
 * gli export in primo piano, i CR2 che stanno dietro a un export fuori
 * dall'album (si aprono dal link al RAW), gli altri CR2 negli "Altri
 * scatti", gli export ancora senza originale collegati al CR2 dello stesso
 * scatto. Si può rifare: ricalcola tutto dalle foto che l'album ha oggi.
 * Dopo, "Riordina" in Coppie lo aggiorna con i collegamenti nuovi (es.
 * quelli per impronta visiva della notte).
 */
export async function arrangeEventAlbum(albumId: number): Promise<{ main: number; extra: number; behind: number } | null> {
  const [rows, camera] = await Promise.all([
    query<PhotoRow & { path: string | null }>(
      `SELECT ${PHOTO_COLUMNS}, p.source_path AS path
         FROM album_photos ap JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
        WHERE ap.album_id = ?`,
      [albumId],
    ),
    cameraIds(),
  ]);
  const sides = eventSides(rows.map((r) => ({ ...r, camera_id: camera(r.camera_id) })));
  if (!sides) return null;
  const s = folderSections(sides.exports, sides.camera);
  const main = [...sides.exports.map((p) => Number(p.id)), ...s.main];
  await applySections(albumId, { ...s, main });
  return { main: main.length, extra: s.extra.length, behind: s.behind.length };
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
