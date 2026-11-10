import "server-only";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { execute, pool, query, queryOne } from "./db";
import { newToken, randomBase62, sha256 } from "./crypto";
import { MAX_ALBUM_DEPTH } from "./album-tree-rules";
import { countDuplicatePairs } from "./duplicates";
import { storage } from "./storage";
import {
  classifyKind,
  storageKeys,
  type AlbumRef,
  type CommitBody,
  type ExistingFiles,
  type ImportActivity,
  type ImportSource,
  type OriginalTarget,
  type UploadTarget,
} from "./import-shared";

/*
 * Logica server dell'import: chiavi dei computer, import, registrazione
 * delle foto, album e collegamento export -> CR2.
 * Usata dalle route /api/import/v1 e dalle pagine /admin/import.
 */

// ---------------------------------------------------------------------
// Chiavi dei computer
// ---------------------------------------------------------------------

/** Chi lavora sull'import: un computer con la sua chiave, o il browser del proprietario (id null). */
export type ImportDevice = { id: number | null; name: string };

/** Il browser del proprietario ("Carica dal browser"): nessuna chiave, si usa la sessione. */
export const BROWSER_DEVICE: ImportDevice = { id: null, name: "Browser" };

/** Crea una chiave e la restituisce in chiaro (unica volta in cui si vede). */
export async function createDevice(name: string, createdBy: number): Promise<string> {
  const token = `pa_${newToken()}`;
  await execute("INSERT INTO import_devices (name, token_hash, token_hint, created_by) VALUES (?, ?, ?, ?)", [
    name,
    sha256(token),
    token.slice(-4),
    createdBy,
  ]);
  return token;
}

/** Computer autenticato dall'header `Authorization: Bearer pa_...`, o null. */
export async function deviceFromRequest(request: Request): Promise<{ id: number; name: string } | null> {
  const header = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(pa_[A-Za-z0-9_-]{20,})$/.exec(header);
  if (!m) return null;
  const device = await queryOne<{ id: number; name: string }>(
    "SELECT id, name FROM import_devices WHERE token_hash = ? AND revoked_at IS NULL",
    [sha256(m[1])],
  );
  if (device) await execute("UPDATE import_devices SET last_used_at = UTC_TIMESTAMP() WHERE id = ?", [device.id]);
  return device;
}

// ---------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------

export type ImportRow = {
  id: number;
  public_id: string;
  source: ImportSource;
  label: string;
  status: "running" | "finished" | "interrupted" | "failed";
  device_id: number | null;
  root_path: string | null;
  started_at: Date;
  finished_at: Date | null;
  files_seen: number;
  files_total: number | null;
  files_imported: number;
  files_skipped: number;
  files_failed: number;
  bytes_total: number | null;
  bytes_done: number;
  bytes_uploaded: number;
  current_file: string | null;
  /** Ultimo stato mandato dal programma mentre lavora (vedi activitySchema). */
  activity_json: ImportActivity | null;
  last_seen_at: Date | null;
  log: string | null;
};

/** Un import "running" senza segnali da più di 2 minuti è probabilmente fermo. */
export const STALE_AFTER_MS = 2 * 60_000;

export function isStale(imp: Pick<ImportRow, "status" | "last_seen_at" | "started_at">): boolean {
  const last = imp.last_seen_at ?? imp.started_at;
  return imp.status === "running" && Date.now() - last.getTime() > STALE_AFTER_MS;
}

export async function startImport(
  device: ImportDevice,
  input: { source: ImportSource; label: string; rootPath?: string; resume?: string },
): Promise<{ publicId: string; resumed: boolean }> {
  if (input.resume) {
    const old = await queryOne<{ id: number }>(
      "SELECT id FROM imports WHERE public_id = ? AND source = ? AND status <> 'finished'",
      [input.resume, input.source],
    );
    if (old) {
      await execute(
        `UPDATE imports SET status = 'running', finished_at = NULL, device_id = ?, last_seen_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [device.id, old.id],
      );
      return { publicId: input.resume, resumed: true };
    }
  }
  const publicId = randomBase62(22);
  await execute(
    `INSERT INTO imports (public_id, source, label, status, device_id, root_path, started_at, last_seen_at)
     VALUES (?, ?, ?, 'running', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [publicId, input.source, input.label, device.id, input.rootPath ?? null],
  );
  return { publicId, resumed: false };
}

/** Import aperto (running) di un computer, per le chiamate successive. */
export async function runningImport(publicId: string): Promise<{ id: number; source: ImportSource } | null> {
  return queryOne<{ id: number; source: ImportSource }>(
    "SELECT id, source FROM imports WHERE public_id = ? AND status = 'running'",
    [publicId],
  );
}

export async function updateProgress(
  importId: number,
  p: {
    filesSeen: number;
    filesTotal?: number;
    bytesTotal?: number;
    bytesDone: number;
    currentFile?: string | null;
    activity?: ImportActivity | null;
  },
) {
  await execute(
    `UPDATE imports
        SET files_seen = ?, files_total = COALESCE(?, files_total), bytes_total = COALESCE(?, bytes_total),
            bytes_done = ?, current_file = ?, activity_json = ?, last_seen_at = UTC_TIMESTAMP()
      WHERE id = ?`,
    [
      p.filesSeen,
      p.filesTotal ?? null,
      p.bytesTotal ?? null,
      p.bytesDone,
      p.currentFile ?? null,
      p.activity ? JSON.stringify(p.activity) : null,
      importId,
    ],
  );
}

export async function addImportError(importId: number, sourcePath: string, message: string) {
  await execute("INSERT INTO import_errors (import_id, source_path, message) VALUES (?, ?, ?)", [
    importId,
    sourcePath,
    message,
  ]);
  await execute("UPDATE imports SET files_failed = files_failed + 1, last_seen_at = UTC_TIMESTAMP() WHERE id = ?", [
    importId,
  ]);
}

export async function finishImport(
  importId: number,
  status: "finished" | "interrupted" | "failed",
  log?: string,
): Promise<{ matched: number; duplicates: number }> {
  await execute(
    `UPDATE imports SET status = ?, finished_at = UTC_TIMESTAMP(), current_file = NULL, activity_json = NULL,
            last_seen_at = UTC_TIMESTAMP(), log = COALESCE(?, log)
      WHERE id = ?`,
    [status, log ?? null, importId],
  );
  const matched = await autoMatch();
  const duplicates = await countDuplicatePairs();
  return { matched, duplicates };
}

// ---------------------------------------------------------------------
// File: controllo duplicati, upload, registrazione
// ---------------------------------------------------------------------

/**
 * Quali di questi file ci sono già (stesso SHA-256). I già presenti
 * vengono comunque aggiunti all'album indicato: in Takeout la stessa foto
 * compare sia nella cartella dell'anno sia in quella dell'album.
 */
export async function checkExisting(
  importId: number,
  items: { sha256: string; album?: AlbumRef | null; intoAlbum?: string }[],
): Promise<ExistingFiles> {
  const rows = await query<{ id: number; sha256: string; import_id: number | null; original_pending: number }>(
    "SELECT id, sha256, import_id, original_pending FROM photos WHERE sha256 IN (?)",
    [items.map((i) => i.sha256)],
  );
  const bySha = new Map(rows.map((r) => [r.sha256, r.id]));
  for (const item of items) {
    const photoId = bySha.get(item.sha256);
    if (photoId) await placeInAlbums(photoId, item);
  }
  // In un import ripreso, i file già caricati da questo stesso import non
  // sono "già presenti": sono stati contati come importati la prima volta.
  const skipped = rows.filter((r) => r.import_id !== importId).length;
  if (skipped > 0) {
    await execute("UPDATE imports SET files_skipped = files_skipped + ?, last_seen_at = UTC_TIMESTAMP() WHERE id = ?", [
      skipped,
      importId,
    ]);
  }
  return { existing: [...bySha.keys()], pendingOriginals: rows.filter((r) => r.original_pending).map((r) => r.sha256) };
}

/**
 * Solo la ricerca, senza import aperto né album: serve al riepilogo del
 * browser per dire quanti file ci sono già prima di iniziare.
 */
export async function lookupExisting(shas: string[]): Promise<ExistingFiles> {
  const rows = await query<{ sha256: string; original_pending: number }>(
    "SELECT sha256, original_pending FROM photos WHERE sha256 IN (?)",
    [shas],
  );
  return { existing: rows.map((r) => r.sha256), pendingOriginals: rows.filter((r) => r.original_pending).map((r) => r.sha256) };
}

export async function prepareUpload(input: {
  sha256: string;
  filename: string;
  takenAt: string | null;
  mime: string;
  withPreview: boolean;
}): Promise<{ original: UploadTarget; preview: UploadTarget | null; thumb: UploadTarget | null }> {
  const keys = storageKeys(input.sha256, input.filename, input.takenAt);
  const s = storage();
  return {
    original: await s.uploadTarget(keys.original, input.mime, "ARCHIVE"),
    preview: input.withPreview ? await s.uploadTarget(keys.preview, "image/jpeg", "STANDARD") : null,
    thumb: input.withPreview ? await s.uploadTarget(keys.thumb, "image/jpeg", "STANDARD") : null,
  };
}

export class ImportProblem extends Error {}

/**
 * Registra una foto già caricata. Controlla che l'originale sia davvero
 * nell'archivio e della dimensione giusta, poi inserisce la riga.
 */
export async function commitPhoto(
  importId: number,
  source: ImportSource,
  c: CommitBody,
): Promise<{ publicId: string; duplicate: boolean }> {
  const keys = storageKeys(c.sha256, c.filename, c.takenAt);
  const s = storage();
  const pending = c.originalPending === true;
  if (pending && !c.withPreview) throw new ImportProblem("Senza anteprima l'originale va caricato prima di registrare la foto.");
  if (!pending) {
    const size = await s.size(keys.original);
    if (size === null) throw new ImportProblem("L'originale non risulta caricato.");
    if (size !== c.size) throw new ImportProblem(`Originale incompleto: ${size} byte invece di ${c.size}.`);
  }
  if (c.withPreview && (await s.size(keys.preview)) === null) {
    throw new ImportProblem("L'anteprima non risulta caricata.");
  }

  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    const cameraId = c.camera && (c.camera.make || c.camera.model) ? await upsertCamera(conn, c.camera) : null;
    const publicId = randomBase62(22);
    const kind = classifyKind(source, c.mime, c.camera ?? null);
    const insert = conn.query<ResultSetHeader>(
      `INSERT INTO photos (
         public_id, kind, import_id, original_filename, source_path, sha256, file_size, mime_type,
         width, height, orientation,
         gcs_original_key, gcs_original_class, original_pending, gcs_preview_key, gcs_thumb_key,
         taken_at, taken_at_subsec, taken_at_utc, camera_id, lens, focal_length_mm, aperture,
         exposure_time, iso, gps_lat, gps_lon, exif_json, title, description, google_photos_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ARCHIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId,
        kind,
        importId,
        c.filename,
        c.sourcePath,
        c.sha256,
        c.size,
        c.mime,
        c.width ?? null,
        c.height ?? null,
        c.orientation ?? null,
        keys.original,
        pending ? 1 : 0,
        c.withPreview ? keys.preview : null,
        c.withPreview ? keys.thumb : null,
        c.takenAt,
        c.takenAtSubsec ?? null,
        c.takenAtUtc ? new Date(c.takenAtUtc) : null,
        cameraId,
        c.lens ?? null,
        c.focalLengthMm ?? null,
        c.aperture ?? null,
        c.exposureTime ?? null,
        c.iso ?? null,
        c.gpsLat ?? null,
        c.gpsLon ?? null,
        c.exif ? JSON.stringify(c.exif) : null,
        c.title ?? null,
        c.description ?? null,
        c.googlePhotosUrl ?? null,
      ],
    );
    // Stesso file già registrato (due computer, o un commit ripetuto): non è un errore.
    const duplicate = await insert.then(
      () => false,
      (e: { code?: string }) => {
        if (e.code === "ER_DUP_ENTRY") return true;
        throw e;
      },
    );
    const [rows] = await conn.query<RowDataPacket[]>("SELECT id, public_id FROM photos WHERE sha256 = ?", [c.sha256]);
    const photo = rows[0] as { id: number; public_id: string };
    await placeInAlbums(photo.id, c, conn);
    await conn.query(
      duplicate
        ? "UPDATE imports SET files_skipped = files_skipped + 1, last_seen_at = UTC_TIMESTAMP() WHERE id = ?"
        : `UPDATE imports SET files_imported = files_imported + 1, bytes_uploaded = bytes_uploaded + ?,
                  last_seen_at = UTC_TIMESTAMP() WHERE id = ?`,
      duplicate ? [importId] : [pending ? 0 : c.size, importId],
    );
    await conn.commit();
    return { publicId: photo.public_id, duplicate };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------
// Originali che arrivano dopo le anteprime (caricamento dal browser)
// ---------------------------------------------------------------------

/** Durata delle sessioni riprendibili di Cloud Storage: 7 giorni, ne teniamo 6. */
const UPLOAD_SESSION_DAYS = 6;

type PendingPhoto = { id: number; gcs_original_key: string; file_size: number; mime_type: string };

async function pendingPhoto(sha: string): Promise<PendingPhoto> {
  const photo = await queryOne<PendingPhoto>(
    "SELECT id, gcs_original_key, file_size, mime_type FROM photos WHERE sha256 = ? AND original_pending = 1",
    [sha],
  );
  if (!photo) throw new ImportProblem("Nessuna foto in attesa di questo originale (forse è già arrivato).");
  return photo;
}

/**
 * Dove caricare l'originale di una foto registrata in attesa del file.
 * Con Cloud Storage apre (o riusa) una sessione riprendibile, legata
 * all'origine della pagina per il CORS; con l'archivio di prova un PUT.
 */
export async function originalTarget(sha: string, opts: { fresh?: boolean; origin: string | null }): Promise<OriginalTarget> {
  const photo = await pendingPhoto(sha);
  const size = Number(photo.file_size);
  const key = photo.gcs_original_key;
  const s = storage();
  if (opts.fresh) await execute("DELETE FROM upload_sessions WHERE object_key = ?", [key]);
  else {
    const saved = await queryOne<{ session_url: string }>(
      "SELECT session_url FROM upload_sessions WHERE object_key = ? AND size = ? AND expires_at > UTC_TIMESTAMP()",
      [key, size],
    );
    if (saved) return { kind: "resumable", url: saved.session_url, size };
  }
  const url = await s.resumableSession(key, photo.mime_type, "ARCHIVE", size, opts.origin);
  if (!url) return { kind: "put", target: await s.uploadTarget(key, photo.mime_type, "ARCHIVE"), size };
  await execute(
    `INSERT INTO upload_sessions (object_key, sha256, size, session_url, expires_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP() + INTERVAL ${UPLOAD_SESSION_DAYS} DAY)
     ON DUPLICATE KEY UPDATE sha256 = VALUES(sha256), size = VALUES(size), session_url = VALUES(session_url),
                             created_at = UTC_TIMESTAMP(), expires_at = VALUES(expires_at)`,
    [key, sha, size, url],
  );
  return { kind: "resumable", url, size };
}

/** L'originale è arrivato: controlla che ci sia tutto e accende il download. */
export async function originalDone(importId: number, sha: string): Promise<{ ok: true }> {
  const photo = await pendingPhoto(sha);
  const size = await storage().size(photo.gcs_original_key);
  if (size === null) throw new ImportProblem("L'originale non risulta caricato.");
  if (size !== Number(photo.file_size)) {
    throw new ImportProblem(`Originale incompleto: ${size} byte invece di ${photo.file_size}.`);
  }
  await execute("UPDATE photos SET original_pending = 0 WHERE id = ?", [photo.id]);
  await execute("DELETE FROM upload_sessions WHERE object_key = ? OR expires_at < UTC_TIMESTAMP()", [photo.gcs_original_key]);
  await execute("UPDATE imports SET bytes_uploaded = bytes_uploaded + ?, last_seen_at = UTC_TIMESTAMP() WHERE id = ?", [
    size,
    importId,
  ]);
  return { ok: true };
}

async function upsertCamera(conn: PoolConnection, cam: { make: string; model: string; serial: string }) {
  const [res] = await conn.query<ResultSetHeader>(
    `INSERT INTO cameras (make, model, serial) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [cam.make.trim(), cam.model.trim(), cam.serial.trim()],
  );
  return res.insertId;
}

// ---------------------------------------------------------------------
// Album
// ---------------------------------------------------------------------

type Runner = Pick<PoolConnection, "query">;

/**
 * Mette la foto nell'album della sua cartella e/o nell'album esistente
 * indicato (caricamento dentro un album aperto). Con entrambi, l'album
 * della cartella (e quelli sopra) diventa sotto-album di quello esistente.
 */
async function placeInAlbums(
  photoId: number,
  where: { album?: AlbumRef | null; intoAlbum?: string },
  conn: Runner = pool(),
): Promise<void> {
  let baseId: number | null = null;
  if (where.intoAlbum) {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT COALESCE(merged_into_id, id) AS id FROM albums WHERE public_id = ? AND deleted_at IS NULL",
      [where.intoAlbum],
    );
    if (!rows[0]) throw new ImportProblem("L'album in cui caricare non esiste più (eliminato o spostato nel cestino).");
    baseId = Number(rows[0].id);
  }
  if (where.album) await addToAlbum(await ensureAlbum(where.album, conn, baseId), photoId, conn);
  else if (baseId !== null) await addToAlbum(baseId, photoId, conn);
}

/**
 * Album della cartella (o dell'album di Takeout), creato se manca, con gli
 * album delle cartelle che la contengono, il primo dei quali dentro
 * `baseId` se c'è. Restituisce l'id in cui mettere la foto (se l'album è
 * stato unito a un altro, quello tenuto).
 */
async function ensureAlbum(album: AlbumRef, conn: Runner = pool(), baseId: number | null = null): Promise<number> {
  let parentId: number | null = baseId;
  for (const p of album.parents ?? []) {
    const id = await upsertAlbum({ origin: album.origin, ref: p.ref, title: p.title }, conn);
    if (parentId !== null) await attachToParent(id, parentId, conn);
    parentId = id;
  }
  const id = await upsertAlbum(album, conn);
  if (parentId !== null) await attachToParent(id, parentId, conn);
  return id;
}

async function upsertAlbum(album: { origin: AlbumRef["origin"]; ref: string; title: string }, conn: Runner): Promise<number> {
  const [res] = await conn.query<ResultSetHeader>(
    `INSERT INTO albums (public_id, title, origin, origin_ref) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [randomBase62(22), album.title, album.origin, album.ref],
  );
  // Album unito a un altro (migrazione 009): le foto vanno in quello tenuto.
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT COALESCE(merged_into_id, id) AS id FROM albums WHERE id = ?",
    [res.insertId],
  );
  return Number(rows[0]?.id ?? res.insertId);
}

/**
 * Mette l'album dentro quello della cartella sopra, solo se oggi è al primo
 * livello: un album che Antonio ha spostato altrove resta dove l'ha messo.
 * Non lo fa se il genitore è nel cestino, se l'album è il genitore stesso o
 * un suo antenato, o se si supererebbero i 3 livelli.
 */
async function attachToParent(childId: number, parentId: number, conn: Runner): Promise<void> {
  if (childId === parentId) return;
  const [[child]] = await conn.query<RowDataPacket[]>("SELECT parent_id FROM albums WHERE id = ?", [childId]);
  if (!child || child.parent_id !== null) return;
  // Antenati del genitore (lui compreso), al massimo 3 livelli.
  const chain: number[] = [];
  for (let cur: number | null = parentId; cur !== null && chain.length <= MAX_ALBUM_DEPTH; ) {
    const [[row]]: [RowDataPacket[], unknown] = await conn.query<RowDataPacket[]>(
      "SELECT id, parent_id, deleted_at FROM albums WHERE id = ?",
      [cur],
    );
    if (!row || (chain.length === 0 && row.deleted_at !== null)) return;
    if (Number(row.id) === childId) return;
    chain.push(Number(row.id));
    cur = row.parent_id === null ? null : Number(row.parent_id);
  }
  const [[h]] = await conn.query<RowDataPacket[]>(
    `SELECT EXISTS (SELECT 1 FROM albums c WHERE c.parent_id = ? AND c.deleted_at IS NULL) AS c1,
            EXISTS (SELECT 1 FROM albums c JOIN albums g ON g.parent_id = c.id AND g.deleted_at IS NULL
                     WHERE c.parent_id = ? AND c.deleted_at IS NULL) AS c2`,
    [childId, childId],
  );
  const height = 1 + Number(h?.c1 ?? 0) + Number(h?.c2 ?? 0);
  if (chain.length + height > MAX_ALBUM_DEPTH) return;
  await conn.query("UPDATE albums SET parent_id = ? WHERE id = ? AND parent_id IS NULL", [parentId, childId]);
}

async function addToAlbum(albumId: number, photoId: number, conn: Runner = pool()) {
  await conn.query("INSERT IGNORE INTO album_photos (album_id, photo_id) VALUES (?, ?)", [albumId, photoId]);
  await conn.query(
    `UPDATE albums a
        JOIN (SELECT MIN(DATE(p.taken_at)) d1, MAX(DATE(p.taken_at)) d2
                FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
               WHERE ap.album_id = ?) x
         SET a.date_from = x.d1, a.date_to = x.d2,
             a.cover_photo_id = COALESCE(a.cover_photo_id, ?)
      WHERE a.id = ?`,
    [albumId, photoId, albumId],
  );
}

// ---------------------------------------------------------------------
// Collegamento export -> CR2
// ---------------------------------------------------------------------

/**
 * Condizione di "candidato": stesso istante di scatto (al secondo, e ai
 * millisecondi se entrambi li hanno), stessa marca e modello, e stesso
 * numero di serie se l'export lo conserva.
 */
export const CANDIDATE_JOIN = `
  JOIN cameras ce ON ce.id = e.camera_id
  JOIN photos r   ON r.kind = 'raw' AND r.deleted_at IS NULL AND r.taken_at = e.taken_at
                 AND (e.taken_at_subsec IS NULL OR r.taken_at_subsec IS NULL OR r.taken_at_subsec = e.taken_at_subsec)
  JOIN cameras cr ON cr.id = r.camera_id AND cr.make = ce.make AND cr.model = ce.model
                 AND (ce.serial = '' OR cr.serial = ce.serial)`;

/** Collega in automatico gli export che hanno un solo CR2 candidato. */
export async function autoMatch(): Promise<number> {
  const res = await execute(
    `UPDATE photos p
       JOIN (SELECT e.id AS eid, MIN(r.id) AS rid, MAX(ce.serial <> '') AS by_serial
               FROM photos e ${CANDIDATE_JOIN}
              WHERE e.kind = 'edit' AND e.deleted_at IS NULL AND e.match_status = 'none'
                AND e.derived_from_id IS NULL
              GROUP BY e.id
             HAVING COUNT(*) = 1) m ON m.eid = p.id
        SET p.derived_from_id = m.rid, p.match_status = 'auto',
            p.match_method = IF(m.by_serial, 'serial+datetime', 'datetime')`,
  );
  return res.affectedRows;
}
