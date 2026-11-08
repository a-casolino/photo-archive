import "server-only";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { execute, pool, query, queryOne } from "./db";
import { newToken, randomBase62, sha256 } from "./crypto";
import { countDuplicatePairs } from "./duplicates";
import { storage } from "./storage";
import {
  classifyKind,
  storageKeys,
  type AlbumRef,
  type CommitBody,
  type ImportActivity,
  type ImportSource,
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

export type ImportDevice = { id: number; name: string };

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
export async function deviceFromRequest(request: Request): Promise<ImportDevice | null> {
  const header = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(pa_[A-Za-z0-9_-]{20,})$/.exec(header);
  if (!m) return null;
  const device = await queryOne<ImportDevice>(
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
  items: { sha256: string; album?: AlbumRef | null }[],
): Promise<string[]> {
  const rows = await query<{ id: number; sha256: string; import_id: number | null }>(
    "SELECT id, sha256, import_id FROM photos WHERE sha256 IN (?)",
    [items.map((i) => i.sha256)],
  );
  const bySha = new Map(rows.map((r) => [r.sha256, r.id]));
  for (const item of items) {
    const photoId = bySha.get(item.sha256);
    if (photoId && item.album) await addToAlbum(await ensureAlbum(item.album), photoId);
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
  return [...bySha.keys()];
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
  const size = await s.size(keys.original);
  if (size === null) throw new ImportProblem("L'originale non risulta caricato.");
  if (size !== c.size) throw new ImportProblem(`Originale incompleto: ${size} byte invece di ${c.size}.`);
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
         gcs_original_key, gcs_original_class, gcs_preview_key, gcs_thumb_key,
         taken_at, taken_at_subsec, taken_at_utc, camera_id, lens, focal_length_mm, aperture,
         exposure_time, iso, gps_lat, gps_lon, exif_json, title, description, google_photos_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ARCHIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    if (c.album) await addToAlbum(await ensureAlbum(c.album, conn), photo.id, conn);
    await conn.query(
      duplicate
        ? "UPDATE imports SET files_skipped = files_skipped + 1, last_seen_at = UTC_TIMESTAMP() WHERE id = ?"
        : `UPDATE imports SET files_imported = files_imported + 1, bytes_uploaded = bytes_uploaded + ?,
                  last_seen_at = UTC_TIMESTAMP() WHERE id = ?`,
      duplicate ? [importId] : [c.size, importId],
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

async function ensureAlbum(album: AlbumRef, conn: Runner = pool()): Promise<number> {
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
