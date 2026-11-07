import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/*
 * Stato locale del programma, in ~/.photo-archive:
 *  - hash.jsonl: impronte SHA-256 già calcolate (percorso + dimensione +
 *    data di modifica), così un import ripreso non rilegge tutto il disco;
 *  - imports.json: l'ultimo import non finito per ogni cartella, da riprendere.
 */

const DIR = process.env.PHOTO_ARCHIVE_STATE_DIR ?? path.join(homedir(), ".photo-archive");
const HASH_FILE = path.join(DIR, "hash.jsonl");
const IMPORTS_FILE = path.join(DIR, "imports.json");

type HashLine = { p: string; s: number; m: number; h: string };

export class HashCache {
  private map = new Map<string, HashLine>();

  static async load(): Promise<HashCache> {
    const c = new HashCache();
    await mkdir(DIR, { recursive: true });
    const text = await readFile(HASH_FILE, "utf8").catch(() => "");
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const l = JSON.parse(line) as HashLine;
        c.map.set(l.p, l);
      } catch {
        // riga rovinata (programma chiuso a metà scrittura): si ignora
      }
    }
    return c;
  }

  get(file: string, size: number, mtimeMs: number): string | null {
    const l = this.map.get(file);
    return l && l.s === size && l.m === Math.round(mtimeMs) ? l.h : null;
  }

  async set(file: string, size: number, mtimeMs: number, sha: string) {
    const l = { p: file, s: size, m: Math.round(mtimeMs), h: sha };
    this.map.set(file, l);
    await appendFile(HASH_FILE, JSON.stringify(l) + "\n");
  }
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file, { highWaterMark: 1 << 20 })
      .on("data", (d) => h.update(d))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });
}

function importKey(server: string, source: string, root: string) {
  return `${server}|${source}|${root}`;
}

async function readImports(): Promise<Record<string, string>> {
  return JSON.parse(await readFile(IMPORTS_FILE, "utf8").catch(() => "{}"));
}

export async function lastOpenImport(server: string, source: string, root: string): Promise<string | undefined> {
  return (await readImports())[importKey(server, source, root)];
}

export async function rememberImport(server: string, source: string, root: string, id: string | null) {
  await mkdir(DIR, { recursive: true });
  const all = await readImports();
  const k = importKey(server, source, root);
  if (id) all[k] = id;
  else delete all[k];
  await writeFile(IMPORTS_FILE, JSON.stringify(all, null, 2));
}
