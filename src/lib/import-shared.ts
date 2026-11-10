import { z } from "zod";

/*
 * Codice condiviso tra l'app (API di import) e il programma di import che
 * gira sul computer di Antonio (scripts/import). Niente dipendenze server:
 * solo tipi, schemi zod e funzioni pure.
 */

export const API_VERSION = "v1";

/**
 * Versione del programma di import. Si alza quando il programma cambia in
 * modo che una copia vecchia salverebbe dati sbagliati: l'app rifiuta le
 * versioni sotto MIN_PROGRAM_VERSION e chiede di aggiornare (git pull).
 * 2: dimensioni delle foto come nel file, JPG anche dal disco.
 */
export const PROGRAM_VERSION = 2;
export const MIN_PROGRAM_VERSION = 2;
export const PROGRAM_VERSION_HEADER = "X-Import-Program";

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
    /^(originals|previews|thumbs|faces)\/[A-Za-z0-9._\-/]+$/.test(key) &&
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
  if (mime === "image/x-canon-cr2" || mime === "image/x-adobe-dng") return "raw";
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
  /**
   * Album che lo contengono (cartelle sopra), dal primo livello in giù:
   * al massimo 2, perché gli album hanno 3 livelli. Mancano per Takeout e
   * per i programmi di import più vecchi (album tutti al primo livello).
   */
  parents: z
    .array(z.object({ ref: z.string().min(1).max(1024), title: z.string().min(1).max(255) }))
    .max(2)
    .optional(),
});
export type AlbumRef = z.infer<typeof albumRef>;

export const createImportBody = z.object({
  source: importSource,
  label: z.string().trim().min(1).max(255),
  rootPath: z.string().max(1024).optional(),
  /** public_id di un import interrotto da riprendere. */
  resume: z.string().length(22).optional(),
});

// ---------------------------------------------------------------------
// Attività in corso (cosa sta facendo il programma, velocità)
// ---------------------------------------------------------------------

/** Le fasi di lavorazione di un file, nell'ordine. */
export const IMPORT_STEPS = ["hash", "check", "exif", "previews", "upload_previews", "upload_original", "commit"] as const;
export type ImportStep = (typeof IMPORT_STEPS)[number];

export const STEP_LABEL: Record<ImportStep, string> = {
  hash: "Calcolo impronta",
  check: "Controllo se è già nell'archivio",
  exif: "Lettura EXIF",
  previews: "Creazione anteprime",
  upload_previews: "Caricamento anteprime",
  upload_original: "Caricamento originale",
  commit: "Registrazione",
};

export const activitySchema = z.object({
  /** Un elemento per file in lavorazione (uno per ogni lavoro in parallelo). */
  workers: z
    .array(
      z.object({
        file: z.string().max(1024),
        step: z.enum(IMPORT_STEPS),
        size: z.number().int().nonnegative(),
        /** Byte dell'originale già inviati (solo durante il caricamento). */
        sent: z.number().int().nonnegative().optional(),
      }),
    )
    .max(16),
  /** Byte al secondo inviati all'archivio, sugli ultimi secondi. */
  uploadBps: z.number().nonnegative(),
  /** Byte al secondo di file lavorati (caricati o già presenti): serve alla stima della fine. */
  doneBps: z.number().nonnegative(),
  parallel: z.number().int().positive().max(16),
});
export type ImportActivity = z.infer<typeof activitySchema>;

/**
 * Velocità su una finestra mobile: si aggiungono byte man mano e
 * `rate()` dà i byte al secondo degli ultimi `windowMs`.
 */
export class RateMeter {
  private samples: { t: number; n: number }[] = [];
  private readonly start: number;

  constructor(
    private readonly windowMs = 20_000,
    private readonly now: () => number = Date.now,
  ) {
    this.start = now();
  }

  add(bytes: number) {
    if (bytes > 0) this.samples.push({ t: this.now(), n: bytes });
  }

  rate(): number {
    const t = this.now();
    const from = t - this.windowMs;
    while (this.samples.length && this.samples[0].t < from) this.samples.shift();
    const total = this.samples.reduce((s, x) => s + x.n, 0);
    // All'inizio la finestra è più corta: si divide per il tempo trascorso davvero.
    const span = Math.max(1000, Math.min(this.windowMs, t - this.start));
    return (total * 1000) / span;
  }
}

export const progressBody = z.object({
  filesSeen: z.number().int().nonnegative(),
  filesTotal: z.number().int().nonnegative().optional(),
  bytesTotal: z.number().int().nonnegative().optional(),
  bytesDone: z.number().int().nonnegative(),
  currentFile: z.string().max(1024).nullable().optional(),
  activity: activitySchema.nullable().optional(),
});

/** Impronte da cercare nell'archivio prima di iniziare (riepilogo del browser). */
export const lookupBody = z.object({
  sha256: z.array(sha256Schema).min(1).max(1000),
});

/** Risposta di check e lookup: già presenti, e tra questi quelli con l'originale ancora da caricare. */
export type ExistingFiles = { existing: string[]; pendingOriginals: string[] };

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
  /**
   * L'originale arriva dopo (caricamento dal browser: prima le anteprime di
   * tutto il lotto, poi i CR2). Richiede l'anteprima.
   */
  originalPending: z.boolean().optional(),
  album: albumRef.nullable().optional(),
});
export type CommitBody = z.infer<typeof commitBody>;

/** Originale di una foto già registrata in attesa del file (original_pending). */
export const originalBody = z.object({
  sha256: sha256Schema,
  /** true = la sessione riprendibile salvata non vale più: aprine una nuova. */
  fresh: z.boolean().optional(),
});

/**
 * Dove caricare un originale: una sessione riprendibile di Cloud Storage
 * (a pezzi, con ripresa) oppure, con l'archivio di prova, un PUT semplice.
 */
export type OriginalTarget =
  | { kind: "resumable"; url: string; size: number }
  | { kind: "put"; target: UploadTarget; size: number };

export const errorBody = z.object({
  sourcePath: relPath,
  message: z.string().min(1).max(2000),
});

export const finishBody = z.object({
  status: z.enum(["finished", "interrupted", "failed"]),
  log: z.string().max(60_000).optional(),
});
