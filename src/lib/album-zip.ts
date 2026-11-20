import "server-only";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { query } from "./db";
import { linkedExport, treeCte } from "./gallery";
import { downloadName } from "./gallery-rules";
import { localPath, storage } from "./storage";
import { safeZipName, uniqueNamer, type ZipEntry } from "./zip-writer";

/*
 * "Scarica tutte" di un album: l'elenco dei file dello ZIP.
 *
 * - Sempre il JPEG grande della versione mostrata (l'export di Lightroom se
 *   c'è), mai gli originali: i CR2 sono in classe Archive e leggerli in
 *   blocco costa (recupero a GB), e i link liberi non li danno comunque.
 * - Con i sotto-album, ognuno nella sua cartella; una foto presente in più
 *   album del ramo compare una volta sola, nel primo (il più in alto).
 * - Gli "Altri scatti" in una cartella a parte dentro il loro album.
 * - Data e ora dei file = data di scatto, così le foto si ordinano da sole.
 */

export const ZIP_EXTRA_FOLDER = "Altri scatti";

type Row = {
  photo_id: number;
  album_id: number;
  parent_id: number | null;
  lvl: number;
  section: "main" | "extra";
  original_filename: string;
  taken_at: Date | null;
  preview_key: string | null;
};

type AlbumNode = { id: number; parent_id: number | null; title: string };

/** Le foto del ramo, già in ordine: album dall'alto in basso, poi l'ordine dell'album. */
async function branchRows(albumId: number): Promise<{ rows: Row[]; albums: Map<number, AlbumNode> }> {
  const [rows, albums] = await Promise.all([
    query<Row>(
      `${treeCte("a.id = ? AND a.deleted_at IS NULL")}
       SELECT p.id AS photo_id, t.id AS album_id, al.parent_id, t.lvl, ap.section, p.original_filename,
              p.taken_at, COALESCE(x.gcs_preview_key, p.gcs_preview_key) AS preview_key
         FROM tree t
         JOIN albums al ON al.id = t.id
         JOIN album_photos ap ON ap.album_id = t.id
         JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
         ${linkedExport()}
        ORDER BY t.lvl, al.title, t.id, ap.section, ap.position, p.taken_at IS NULL, p.taken_at, p.taken_at_subsec, p.id`,
      [albumId],
    ),
    query<AlbumNode>(
      `${treeCte("a.id = ? AND a.deleted_at IS NULL")}
       SELECT al.id, al.parent_id, al.title FROM tree t JOIN albums al ON al.id = t.id`,
      [albumId],
    ),
  ]);
  return { rows, albums: new Map(albums.map((a) => [a.id, a])) };
}

/**
 * Data dei file nello ZIP. taken_at è l'ora della fotocamera salvata così
 * com'è (l'interfaccia la mostra in UTC per non spostarla, vedi
 * formatTakenAt): qui si fa lo stesso.
 */
function takenParts(d: Date | null): ZipEntry["date"] {
  if (!d) return null;
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

/** Apre un file dell'archivio come flusso di byte (null se non c'è). */
async function openKey(key: string): Promise<AsyncIterable<Uint8Array> | null> {
  const s = storage();
  if (s.driver === "local") {
    try {
      const stream = createReadStream(localPath(key));
      await new Promise<void>((resolve, reject) => {
        stream.once("open", () => resolve());
        stream.once("error", reject);
      });
      return stream;
    } catch {
      return null;
    }
  }
  const res = await fetch(await s.readUrl(key, 15 * 60));
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    return null;
  }
  return Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>);
}

export type AlbumZip = { count: number; entries: AsyncIterable<ZipEntry> };

/**
 * I file dello ZIP dell'album `albumId` (con i sotto-album). La cartella
 * principale ha il nome dell'album. Ogni file si scarica solo quando lo
 * ZIP arriva lì; il successivo si apre in anticipo (una richiesta a GCS
 * alla volta in più), così l'attesa tra un file e l'altro non si somma.
 */
export async function albumZip(albumId: number): Promise<AlbumZip> {
  const { rows, albums } = await branchRows(albumId);
  const folderOf = new Map<number, string>();
  const folder = (id: number): string => {
    const cached = folderOf.get(id);
    if (cached !== undefined) return cached;
    const a = albums.get(id);
    const own = safeZipName(a?.title ?? "", "Album");
    const path = id === albumId || !a?.parent_id || !albums.has(a.parent_id) ? own : `${folder(a.parent_id)}/${own}`;
    folderOf.set(id, path);
    return path;
  };

  const name = uniqueNamer();
  const seen = new Set<number>();
  const files: { name: string; key: string; taken_at: Date | null }[] = [];
  for (const r of rows) {
    if (!r.preview_key || seen.has(r.photo_id)) continue;
    seen.add(r.photo_id);
    const dir = folder(r.album_id) + (r.section === "extra" ? `/${ZIP_EXTRA_FOLDER}` : "");
    const file = safeZipName(downloadName(r.original_filename, "preview"), "foto.jpg");
    files.push({
      name: name(dir, file),
      key: r.preview_key,
      taken_at: r.taken_at,
    });
  }

  async function* entries(): AsyncGenerator<ZipEntry> {
    let next: Promise<AsyncIterable<Uint8Array> | null> | null = null;
    const open = (i: number) => openKey(files[i].key).catch(() => null);
    try {
      for (let i = 0; i < files.length; i++) {
        const current = next ?? open(i);
        next = i + 1 < files.length ? open(i + 1) : null;
        yield {
          name: files[i].name,
          date: takenParts(files[i].taken_at),
          open: () => current,
        };
      }
    } finally {
      // Download interrotto: chiude il file già aperto in anticipo.
      void next?.then((body) => (body as Readable | null)?.destroy());
    }
  }

  return { count: files.length, entries: entries() };
}
