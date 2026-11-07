import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { AlbumRef, ImportSource } from "../../src/lib/import-shared";
import { mimeFor, VIDEO_EXT } from "./metadata";
import { findSidecar, isNonAlbumFolder } from "./takeout";

/*
 * Scansione della cartella: elenco dei file da importare, con album e
 * (per Takeout) il JSON di accompagnamento.
 */

export type FileEntry = {
  abs: string;
  rel: string; // percorso relativo alla cartella, con "/"
  name: string;
  size: number;
  mtimeMs: number;
  mime: string;
  album: AlbumRef | null;
  sidecar: string | null; // percorso assoluto del JSON di Takeout
};

export type ScanResult = { files: FileEntry[]; videos: number; ignored: number; bytes: number };

const SKIP_DIRS = new Set([".git", "node_modules", ".Trashes", ".Spotlight-V100", ".fseventsd", "$RECYCLE.BIN", "System Volume Information"]);

export async function scan(
  root: string,
  source: ImportSource,
  opts: { albums: boolean; onProgress?: (n: number) => void },
): Promise<ScanResult> {
  const result: ScanResult = { files: [], videos: 0, ignored: 0, bytes: 0 };

  async function walk(dir: string, albumTitle: string | null) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      console.warn(`  ! cartella non leggibile: ${dir} (${(e as Error).message})`);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const names = entries.filter((e) => e.isFile()).map((e) => e.name);
    const relDir = path.relative(root, dir).split(path.sep).join("/");

    // Album di questa cartella
    let album: AlbumRef | null = null;
    if (opts.albums && relDir) {
      if (source === "cr2_disk") {
        album = { origin: "disk_folder", ref: relDir, title: path.basename(dir).slice(0, 255) };
      } else if (names.includes("metadata.json") && !isNonAlbumFolder(path.basename(dir))) {
        const meta = JSON.parse(await readFile(path.join(dir, "metadata.json"), "utf8").catch(() => "{}"));
        const title = String(meta.title || albumTitle || path.basename(dir)).slice(0, 255);
        // Il nome della cartella, non il percorso: così non dipende da dove è stato estratto il Takeout.
        album = { origin: "google_photos", ref: path.basename(dir), title };
      }
    }

    const jsonNames = source === "google_takeout" ? names.filter((n) => n.toLowerCase().endsWith(".json")) : [];

    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !(source === "google_takeout" && /^(trash|cestino|bin)$/i.test(e.name))) {
          await walk(abs, null);
        }
        continue;
      }
      if (!e.isFile()) continue;
      if (VIDEO_EXT.test(e.name)) {
        result.videos++;
        continue;
      }
      const mime = mimeFor(e.name);
      const wanted = source === "cr2_disk" ? mime === "image/x-canon-cr2" : mime !== null;
      if (!wanted) {
        if (!e.name.toLowerCase().endsWith(".json")) result.ignored++;
        continue;
      }
      const st = await stat(abs);
      const sidecar = source === "google_takeout" ? findSidecar(e.name, jsonNames) : null;
      result.files.push({
        abs,
        rel: path.relative(root, abs).split(path.sep).join("/"),
        name: e.name,
        size: st.size,
        mtimeMs: st.mtimeMs,
        mime: mime!,
        album,
        sidecar: sidecar ? path.join(dir, sidecar) : null,
      });
      result.bytes += st.size;
      opts.onProgress?.(result.files.length);
    }
  }

  await walk(root, null);
  return result;
}
