import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { isValidStorageKey, type StorageClass, type UploadTarget } from "./import-shared";

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
   * URL di lettura temporaneo. Con `downloadName` il browser scarica il
   * file con quel nome invece di aprirlo.
   */
  readUrl(key: string, ttlSeconds?: number, downloadName?: string): Promise<string>;
  /** Dimensione del file, o null se non esiste. */
  size(key: string): Promise<number | null>;
}

const UPLOAD_TTL_SECONDS = 6 * 3600;
const READ_TTL_SECONDS = 15 * 60;

// ---------------------------------------------------------------------
// Driver locale
// ---------------------------------------------------------------------

const g = globalThis as unknown as { __storageSecret?: string; __gcsBucket?: unknown };

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
  const exp = Math.floor(Date.now() / 1000) + ttl;
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
  async readUrl(key, ttl = READ_TTL_SECONDS, downloadName) {
    const [url] = await (await bucket()).file(key).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + ttl * 1000,
      ...(downloadName ? { responseDisposition: attachmentDisposition(downloadName) } : {}),
    });
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
};

export function storage(): FileStorage {
  return env().STORAGE_DRIVER === "gcs" ? gcsStorage : localStorage;
}
