import { z } from "zod";

/*
 * Codice condiviso tra l'app (API di import) e il programma di import che
 * gira sul computer di Antonio (scripts/import). Niente dipendenze server:
 * solo tipi, schemi zod e funzioni pure.
 */

export const API_VERSION = "v1";

export type StorageClass = "ARCHIVE" | "COLDLINE" | "NEARLINE" | "STANDARD";

/** Come caricare un file: PUT su `url` (relativo all'app o assoluto) con questi header. */
export type UploadTarget = { url: string; method: "PUT"; headers: Record<string, string> };

export const PREVIEW_LONG_SIDE = 2048;
export const THUMB_LONG_SIDE = 400;

// ---------------------------------------------------------------------
// Chiavi dei file nell'archivio
// ---------------------------------------------------------------------

const SHA256_RE = /^[0-9a-f]{64}$/;
const TAKEN_AT_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** Solo caratteri sicuri, niente "..", niente percorsi assoluti. */
export function isValidStorageKey(key: string): boolean {
  return (
    /^(originals|previews|thumbs)\/[A-Za-z0-9._\-/]+$/.test(key) &&
    key.length <= 512 &&
    !key.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

/** Nome file ripulito per stare in una chiave GCS leggibile. */
export function safeFilename(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(-120);
  return cleaned || "file";
}

/**
 * Chiavi deterministiche: stesso file -> stesse chiavi, così un upload
 * ripetuto (import interrotto e ripreso) sovrascrive invece di duplicare.
 *   originals/2014/2014-07-12/1a2b3c4d_IMG_4821.CR2
 *   previews/1a/1a2b...64.jpg      thumbs/1a/1a2b...64.jpg
 */
export function storageKeys(sha256: string, filename: string, takenAt: string | null) {
  if (!SHA256_RE.test(sha256)) throw new Error("sha256 non valido.");
  const m = takenAt ? TAKEN_AT_RE.exec(takenAt) : null;
  const folder = m ? `${m[1]}/${m[1]}-${m[2]}-${m[3]}` : "senza-data";
  return {
    original: `originals/${folder}/${sha256.slice(0, 8)}_${safeFilename(filename)}`,
    preview: `previews/${sha256.slice(0, 2)}/${sha256}.jpg`,
    thumb: `thumbs/${sha256.slice(0, 2)}/${sha256}.jpg`,
  };
}

// ---------------------------------------------------------------------
// EXIF
// ---------------------------------------------------------------------

/**
 * SubSecTimeOriginal è una frazione di secondo scritta come cifre:
 * "45" = 0,45 s, "045" = 0,045 s. La salviamo in millisecondi.
 */
export function normalizeSubsec(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  return Number((s + "000").slice(0, 3));
}

export type CameraInfo = { make: string; model: string; serial: string };

const CAMERA_MAKERS = /^(canon|nikon|sony|fujifilm|olympus|om digital|panasonic|pentax|ricoh|leica|sigma|hasselblad)/i;

/**
 * Tipo di foto:
 *  - dal disco: i CR2 sono 'raw';
 *  - da Takeout: se l'EXIF dice che viene da una fotocamera (marca da
 *    fotocamera o numero di serie) è un export, quindi 'edit' da
 *    collegare al suo CR2; altrimenti è una foto del telefono.
 */
export function classifyKind(source: ImportSource, mime: string, camera: CameraInfo | null): "raw" | "phone" | "edit" {
  if (source === "cr2_disk" || mime === "image/x-canon-cr2") return "raw";
  if (camera && (camera.serial !== "" || CAMERA_MAKERS.test(camera.make))) return "edit";
  return "phone";
}

// ---------------------------------------------------------------------
// Schemi delle richieste all'API /api/import/v1
// ---------------------------------------------------------------------

export const importSource = z.enum(["cr2_disk", "google_takeout"]);
export type ImportSource = z.infer<typeof importSource>;

const sha256Schema = z.string().regex(SHA256_RE);
const relPath = z.string().min(1).max(1024);

export const albumRef = z.object({
  origin: z.enum(["disk_folder", "google_photos"]),
  ref: z.string().min(1).max(1024),
  title: z.string().min(1).max(255),
});
export type AlbumRef = z.infer<typeof albumRef>;

export const createImportBody = z.object({
  source: importSource,
  label: z.string().trim().min(1).max(255),
  rootPath: z.string().max(1024).optional(),
  /** public_id di un import interrotto da riprendere. */
  resume: z.string().length(22).optional(),
});

export const progressBody = z.object({
  filesSeen: z.number().int().nonnegative(),
  filesTotal: z.number().int().nonnegative().optional(),
  bytesTotal: z.number().int().nonnegative().optional(),
  bytesDone: z.number().int().nonnegative(),
  currentFile: z.string().max(1024).nullable().optional(),
});

export const checkBody = z.object({
  items: z
    .array(z.object({ sha256: sha256Schema, album: albumRef.nullable().optional() }))
    .min(1)
    .max(500),
});

export const prepareBody = z.object({
  sha256: sha256Schema,
  filename: z.string().min(1).max(255),
  takenAt: z.string().regex(TAKEN_AT_RE).nullable(),
  mime: z.string().min(1).max(64),
  withPreview: z.boolean(),
});

const nullableNum = z.number().finite().nullable().optional();

export const commitBody = z.object({
  sha256: sha256Schema,
  filename: z.string().min(1).max(255),
  sourcePath: relPath,
  size: z.number().int().positive(),
  mime: z.string().min(1).max(64),
  width: z.number().int().positive().max(65535).nullable().optional(),
  height: z.number().int().positive().max(65535).nullable().optional(),
  orientation: z.number().int().min(1).max(8).nullable().optional(),
  takenAt: z.string().regex(TAKEN_AT_RE).nullable(),
  takenAtSubsec: z.number().int().min(0).max(999).nullable().optional(),
  takenAtUtc: z.iso.datetime().nullable().optional(),
  camera: z
    .object({ make: z.string().max(64), model: z.string().max(128), serial: z.string().max(64) })
    .nullable()
    .optional(),
  lens: z.string().max(128).nullable().optional(),
  focalLengthMm: nullableNum,
  aperture: nullableNum,
  exposureTime: z.string().max(16).nullable().optional(),
  iso: z.number().int().nonnegative().max(16_777_215).nullable().optional(),
  gpsLat: z.number().min(-90).max(90).nullable().optional(),
  gpsLon: z.number().min(-180).max(180).nullable().optional(),
  exif: z.record(z.string(), z.unknown()).nullable().optional(),
  title: z.string().max(255).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  googlePhotosUrl: z.string().max(512).nullable().optional(),
  withPreview: z.boolean(),
  album: albumRef.nullable().optional(),
});
export type CommitBody = z.infer<typeof commitBody>;

export const errorBody = z.object({
  sourcePath: relPath,
  message: z.string().min(1).max(2000),
});

export const finishBody = z.object({
  status: z.enum(["finished", "interrupted", "failed"]),
  log: z.string().max(60_000).optional(),
});
