import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { isValidStorageKey, type StorageClass, type UploadTarget } from "./import-shared";
import { stableSignWindow } from "./signing-rules";

/*
 * Archivio dei file: CR2 originali e anteprime JPEG.
 *
 * - "gcs": Google Cloud Storage. Il programma di import carica i file
 *   direttamente sul bucket con URL firmati (PUT), senza passare dalla VPS.
 *   I CR2 vanno in classe ARCHIVE, le anteprime in STANDARD.
 * - "local": una cartella sul server, per provare tutto senza Google Cloud.
 *   Gli URL firmati puntano a /api/storage/... di questa stessa app.
 */

export interface FileStorage {
  readonly driver: "local" | "gcs";
  /** Dove e come caricare un file (valido qualche ora). */
  uploadTarget(key: string, contentType: string, storageClass: StorageClass): Promise<UploadTarget>;
  /**
   * Apre una sessione di caricamento riprendibile (a pezzi, con ripresa) e ne
   * restituisce l'indirizzo, valido 7 giorni per quel solo file. `origin` è
   * l'origine della pagina che caricherà (serve al CORS del bucket). null se
   * l'archivio non le supporta (cartella di prova): si usa uploadTarget.
   */
  resumableSession(
    key: string,
    contentType: string,
    storageClass: StorageClass,
    size: number,
    origin: string | null,
  ): Promise<string | null>;
  /**
   * URL di lettura temporaneo. Con `downloadName` il browser scarica il
   * file con quel nome invece di aprirlo.
   */
  readUrl(key: string, ttlSeconds?: number, downloadName?: string): Promise<string>;
  /** Dimensione del file, o null se non esiste. */
  size(key: string): Promise<number | null>;
  /** Legge un file intero (usato dai lavori sul server, es. i volti). */
  read(key: string): Promise<Buffer>;
  /** Scrive un file piccolo direttamente dal server (es. miniature dei volti). */
  write(key: string, data: Buffer, contentType: string, storageClass: StorageClass): Promise<void>;
  /** Cancella un file. Un file che non c'è già più non è un errore. */
  remove(key: string): Promise<void>;
}

const UPLOAD_TTL_SECONDS = 6 * 3600;
const READ_TTL_SECONDS = 15 * 60;

// ---------------------------------------------------------------------
// Driver locale
// ---------------------------------------------------------------------

const g = globalThis as unknown as {
  __storageSecret?: string;
  __gcsBucket?: unknown;
  /** URL di lettura già firmati nella finestra corrente (vedi readUrl di GCS). */
  __signedUrls?: Map<string, string>;
  __signedWindow?: number;
};
const MAX_CACHED_URLS = 20000;

function signingSecret(): string {
  const configured = env().STORAGE_SIGNING_SECRET;
  if (configured) return configured;
  if (!g.__storageSecret) {
    g.__storageSecret = randomBytes(32).toString("hex");
    console.warn("[storage] STORAGE_SIGNING_SECRET non impostato: uso un segreto temporaneo.");
  }
  return g.__storageSecret;
}

export function signLocal(method: "GET" | "PUT", key: string, exp: number): string {
  return createHmac("sha256", signingSecret()).update(`${method}\n${key}\n${exp}`).digest("base64url");
}

export function verifyLocal(method: "GET" | "PUT", key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = Buffer.from(signLocal(method, key, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Percorso assoluto del file per una chiave, sempre dentro STORAGE_LOCAL_DIR. */
export function localPath(key: string): string {
  if (!isValidStorageKey(key)) throw new Error("Chiave non valida.");
  const root = path.resolve(env().STORAGE_LOCAL_DIR);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Chiave non valida.");
  return full;
}

function localUrl(method: "GET" | "PUT", key: string, ttl: number, downloadName?: string): string {
  // Letture senza nome di download: scadenza arrotondata, URL stabile (vedi signing-rules).
  const exp =
    method === "GET" && !downloadName
      ? Math.floor(stableSignWindow(Date.now(), ttl).expires / 1000)
      : Math.floor(Date.now() / 1000) + ttl;
  const sig = signLocal(method, key, exp);
  // Relativo: il programma di import lo risolve rispetto all'indirizzo del server.
  const dl = downloadName ? `&dl=${encodeURIComponent(downloadName)}` : "";
  return `/api/storage/${key.split("/").map(encodeURIComponent).join("/")}?exp=${exp}&sig=${sig}${dl}`;
}

/** Header Content-Disposition per scaricare con un nome (anche non ASCII). */
export function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const localStorage: FileStorage = {
  driver: "local",
  async uploadTarget(key, contentType, storageClass) {
    await mkdir(path.dirname(localPath(key)), { recursive: true });
    return {
      url: localUrl("PUT", key, UPLOAD_TTL_SECONDS),
      method: "PUT",
      headers: { "Content-Type": contentType, "x-goog-storage-class": storageClass },
    };
  },
  async resumableSession() {
    return null;
  },
  async readUrl(key, ttl = READ_TTL_SECONDS, downloadName) {
    return localUrl("GET", key, ttl, downloadName);
  },
  async size(key) {
    try {
      return (await stat(localPath(key))).size;
    } catch {
      return null;
    }
  },
  async read(key) {
    return readFile(localPath(key));
  },
  async write(key, data) {
    const file = localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  },
  async remove(key) {
    try {
      await unlink(localPath(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  },
};

// ---------------------------------------------------------------------
// Driver Google Cloud Storage
// ---------------------------------------------------------------------

type Bucket = import("@google-cloud/storage").Bucket;

async function bucket(): Promise<Bucket> {
  if (!g.__gcsBucket) {
    const name = env().GCS_BUCKET;
    if (!name) throw new Error("GCS_BUCKET non impostato.");
    const { Storage } = await import("@google-cloud/storage");
    const { GCS_KEY_FILE: keyFile, GCS_KEY_JSON: keyJson } = env();
    const options = keyJson ? { credentials: JSON.parse(keyJson) } : keyFile ? { keyFilename: keyFile } : {};
    g.__gcsBucket = new Storage(options).bucket(name);
  }
  return g.__gcsBucket as Bucket;
}

const gcsStorage: FileStorage = {
  driver: "gcs",
  async uploadTarget(key, contentType, storageClass) {
    const headers = { "x-goog-storage-class": storageClass };
    const [url] = await (await bucket()).file(key).getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + UPLOAD_TTL_SECONDS * 1000,
      contentType,
      extensionHeaders: headers,
    });
    return { url, method: "PUT", headers: { "Content-Type": contentType, ...headers } };
  },
  async resumableSession(key, contentType, storageClass, size, origin) {
    const [url] = await (await bucket()).file(key).createResumableUpload({
      metadata: { contentType, contentLength: size, storageClass },
      ...(origin ? { origin } : {}),
    });
    return url;
  },
  async readUrl(key, ttl = READ_TTL_SECONDS, downloadName) {
    if (downloadName) {
      const [url] = await (await bucket()).file(key).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + ttl * 1000,
        responseDisposition: attachmentDisposition(downloadName),
      });
      return url;
    }
    // Anteprime e miniature: firmate con l'ora arrotondata, così lo stesso file
    // ha lo stesso URL per un'ora e il browser lo riusa dalla cache. Gli URL
    // già firmati in questa finestra si riusano anche qui (niente firma RSA
    // ripetuta per le 200 miniature di ogni pagina).
    const win = stableSignWindow(Date.now(), ttl);
    const cacheKey = `${ttl}:${key}`;
    if (g.__signedWindow !== win.accessibleAt) {
      g.__signedWindow = win.accessibleAt;
      g.__signedUrls = new Map();
    }
    const cache = (g.__signedUrls ??= new Map());
    const hit = cache.get(cacheKey);
    if (hit) return hit;
    const [url] = await (await bucket()).file(key).getSignedUrl({
      version: "v4",
      action: "read",
      accessibleAt: win.accessibleAt,
      expires: win.expires,
    });
    if (cache.size >= MAX_CACHED_URLS) cache.clear();
    cache.set(cacheKey, url);
    return url;
  },
  async size(key) {
    try {
      const [meta] = await (await bucket()).file(key).getMetadata();
      return Number(meta.size);
    } catch (e) {
      if ((e as { code?: number }).code === 404) return null;
      throw e;
    }
  },
  // Lettura e scrittura passano da URL firmati e fetch, non dagli stream della
  // libreria: chiamati migliaia di volte di seguito (npm run volti) lasciavano
  // listener appesi (MaxListenersExceededWarning).
  async read(key) {
    const res = await fetch(await this.readUrl(key, 300));
    if (!res.ok) throw new Error(`Lettura di ${key} non riuscita: HTTP ${res.status}.`);
    return Buffer.from(await res.arrayBuffer());
  },
  async write(key, data, contentType, storageClass) {
    const target = await this.uploadTarget(key, contentType, storageClass);
    const res = await fetch(target.url, { method: target.method, headers: target.headers, body: new Uint8Array(data) });
    if (!res.ok) throw new Error(`Scrittura di ${key} non riuscita: HTTP ${res.status}.`);
  },
  // Serve il permesso storage.objects.delete (incluso in "Storage Object Admin").
  async remove(key) {
    await (await bucket()).file(key).delete({ ignoreNotFound: true });
  },
};

export function storage(): FileStorage {
  return env().STORAGE_DRIVER === "gcs" ? gcsStorage : localStorage;
}
