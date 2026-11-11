import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { AlbumRef, ImportSource } from "../../src/lib/import-shared";
import { mimeFor, VIDEO_EXT } from "./metadata";
import { albumMetadataFile, findSidecar, isNonAlbumFolder } from "./takeout";
import { diskAlbum } from "../../src/lib/import-albums";

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

export { diskAlbum };

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
    if (opts.albums && source === "cr2_disk") {
      // Anche i file direttamente nella cartella scelta vanno in un album, col
      // nome della cartella (non per la radice di un disco, che non ha nome).
      const ref = relDir || path.basename(path.resolve(root));
      if (ref) album = diskAlbum(path.basename(path.resolve(root)), relDir);
    } else if (opts.albums && relDir) {
      // Ogni cartella di Takeout con foto è un album, tranne anni e cestino. Il
      // titolo viene dal file dei metadati dell'album, se c'è.
      if (!isNonAlbumFolder(path.basename(dir)) && names.some((n) => mimeFor(n) !== null)) {
        const metaFile = albumMetadataFile(names);
        const meta = metaFile
          ? JSON.parse(await readFile(path.join(dir, metaFile), "utf8").catch(() => "{}"))
          : {};
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
      // Dal disco anche JPG, HEIC, PNG…: i CR2 diventano "raw", le altre foto
      // "edit" (se l'EXIF è di una fotocamera, es. export di Lightroom) o "phone".
      if (mime === null) {
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
        mime,
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
