import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { MODEL_FILES } from "../../src/lib/faces/constants";

/*
 * Scarica i modelli InsightFace "buffalo_l" dalla release ufficiale su
 * GitHub (circa 280 MB) e tiene solo i due che servono (~190 MB).
 */

export const BUFFALO_URL = "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip";

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

/** Elenco dei file di uno zip (senza ZIP64: buffalo_l.zip è sotto i 4 GB). */
export function zipEntries(zip: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Lo zip non è valido (manca la directory centrale).");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("Lo zip non è valido.");
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    entries.push({
      method: zip.readUInt16LE(p + 10),
      compressedSize: zip.readUInt32LE(p + 20),
      localOffset: zip.readUInt32LE(p + 42),
      name: zip.toString("utf8", p + 46, p + 46 + nameLen),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function zipExtract(zip: Buffer, entry: ZipEntry): Buffer {
  const p = entry.localOffset;
  if (zip.readUInt32LE(p) !== 0x04034b50) throw new Error(`Lo zip non è valido (${entry.name}).`);
  const start = p + 30 + zip.readUInt16LE(p + 26) + zip.readUInt16LE(p + 28);
  const data = zip.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`Compressione ${entry.method} non gestita (${entry.name}).`);
}

/**
 * Il server dei file delle release di GitHub a volte risponde 502/503/504:
 * riprova qualche volta con attese crescenti prima di arrendersi.
 */
async function downloadWithRetry(url: string, attempts = 6): Promise<Buffer> {
  for (let i = 1; ; i++) {
    console.log(`Scarico ${url} (tentativo ${i} di ${attempts}) …`);
    try {
      const res = await fetch(url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status < 500 && res.status !== 429) throw new Error(`Download non riuscito: HTTP ${res.status}.`);
      if (i >= attempts) throw new Error(`Download non riuscito: HTTP ${res.status}.`);
      console.log(`  HTTP ${res.status}, riprovo.`);
    } catch (e) {
      if (i >= attempts || (e as Error).message.startsWith("Download non riuscito")) {
        throw new Error(
          `${(e as Error).message} Scaricalo a mano (curl -L) e usa: npm run volti -- --scarica-modelli --zip percorso/buffalo_l.zip`,
        );
      }
      console.log(`  ${(e as Error).message}, riprovo.`);
    }
    await new Promise((r) => setTimeout(r, 5000 * i));
  }
}

export async function downloadModels(modelDir: string, zipPath?: string): Promise<void> {
  let zip: Buffer;
  if (zipPath) {
    zip = await readFile(zipPath);
  } else {
    zip = await downloadWithRetry(BUFFALO_URL);
  }
  console.log(`Zip: ${(zip.length / 1e6).toFixed(0)} MB, sha256 ${createHash("sha256").update(zip).digest("hex")}`);
  const entries = zipEntries(zip);
  await mkdir(modelDir, { recursive: true });
  for (const file of Object.values(MODEL_FILES)) {
    const entry = entries.find((e) => path.posix.basename(e.name) === file);
    if (!entry) throw new Error(`${file} non è nello zip.`);
    const data = zipExtract(zip, entry);
    await writeFile(path.join(modelDir, file), data);
    console.log(`${file}: ${(data.length / 1e6).toFixed(0)} MB, sha256 ${createHash("sha256").update(data).digest("hex")}`);
  }
  console.log(`Modelli pronti in ${path.resolve(modelDir)}.`);
}
