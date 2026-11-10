import type { AlbumRef } from "../import-shared";
import { diskAlbum } from "../import-albums";
import { mimeFor, VIDEO_EXT } from "../photo-metadata";

/*
 * Caricamento dal browser: dall'elenco dei file scelti (o trascinati) a
 * quello che verrà caricato, con l'album di ognuno. Funzioni pure, testate
 * in tests/upload-plan.test.ts.
 *
 * Le cartelle diventano album come nel programma di import: la cartella
 * scelta è il primo livello, le sottocartelle i sotto-album (al massimo 3
 * livelli, oltre il resto del percorso va nel titolo). I file scelti da
 * soli (o dalla galleria del telefono) vanno nell'album indicato nel
 * riepilogo, o in nessun album.
 */

/** Un file scelto, con il percorso relativo ("Viaggi/2019/IMG_1.CR2", o solo il nome). */
export type PickedFile = { file: File; path: string };

export type SkipReason = "video" | "other" | "system";

export type PlanItem = {
  file: File;
  path: string;
  name: string;
  size: number;
  mime: string;
  /** Album della cartella; null per i file sciolti (album scelto nel riepilogo). */
  album: AlbumRef | null;
  loose: boolean;
};

export type Plan = {
  items: PlanItem[];
  skipped: Record<SkipReason, number>;
  /** Nomi delle cartelle scelte (primo livello). */
  roots: string[];
};

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".Trashes",
  ".Spotlight-V100",
  ".fseventsd",
  "$RECYCLE.BIN",
  "System Volume Information",
]);

/** File di sistema o nascosti, da non contare nemmeno tra gli ignorati. */
function isSystemPath(segments: string[]): boolean {
  return segments.some((s) => s.startsWith(".") || SKIP_DIRS.has(s)) || /^(thumbs\.db|desktop\.ini)$/i.test(segments.at(-1) ?? "");
}

/** Percorso pulito: barre in avanti, niente segmenti vuoti. */
export function splitPath(path: string): string[] {
  return path.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
}

export function planUpload(picked: PickedFile[]): Plan {
  const plan: Plan = { items: [], skipped: { video: 0, other: 0, system: 0 }, roots: [] };
  const roots = new Set<string>();
  const seen = new Set<string>();
  for (const { file, path } of picked) {
    const segments = splitPath(path || file.name);
    if (segments.length === 0) continue;
    const key = segments.join("/");
    if (seen.has(key)) continue; // stesso file scelto due volte
    seen.add(key);
    if (isSystemPath(segments)) {
      plan.skipped.system++;
      continue;
    }
    const name = segments[segments.length - 1];
    if (VIDEO_EXT.test(name)) {
      plan.skipped.video++;
      continue;
    }
    const mime = mimeFor(name);
    if (!mime) {
      plan.skipped.other++;
      continue;
    }
    const loose = segments.length === 1;
    let album: AlbumRef | null = null;
    if (!loose) {
      const [root, ...rest] = segments;
      roots.add(root);
      album = diskAlbum(root, rest.slice(0, -1).join("/"));
    }
    plan.items.push({ file, path: segments.join("/"), name, size: file.size, mime, album, loose });
  }
  plan.items.sort((a, b) => a.path.localeCompare(b.path));
  plan.roots = [...roots].sort((a, b) => a.localeCompare(b));
  return plan;
}

/** Album per i file sciolti, col titolo scelto nel riepilogo (vuoto = nessun album). */
export function looseAlbum(title: string): AlbumRef | null {
  const t = title.trim().slice(0, 255);
  return t ? { origin: "disk_folder", ref: `browser/${t}`, title: t } : null;
}

export type AlbumSummary = { key: string; title: string; depth: number; files: number; bytes: number };

/**
 * Gli album che verranno creati (o riempiti), in ordine ad albero: titolo,
 * livello (1..3) e foto che riceve direttamente. Oltre il terzo livello il
 * titolo è già il resto del percorso ("Roma › giorno 2").
 */
export function albumSummary(items: { album: AlbumRef | null; size: number }[]): AlbumSummary[] {
  const by = new Map<string, AlbumSummary>();
  const touch = (chain: string[]) => {
    const key = chain.join("\u0000");
    let s = by.get(key);
    if (!s) by.set(key, (s = { key, title: chain[chain.length - 1], depth: chain.length, files: 0, bytes: 0 }));
    return s;
  };
  for (const it of items) {
    if (!it.album) continue;
    const chain = [...(it.album.parents ?? []).map((p) => p.title), it.album.title];
    chain.forEach((_, i) => touch(chain.slice(0, i + 1)));
    const s = touch(chain);
    s.files++;
    s.bytes += it.size;
  }
  // Confronto per codice (non localeCompare, che ignora "\u0000"): il genitore viene prima dei figli.
  return [...by.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Etichetta dell'import nella pagina Import. */
export function uploadLabel(roots: string[], looseCount: number): string {
  const parts = roots.slice(0, 3);
  if (roots.length > 3) parts.push(`altre ${roots.length - 3}`);
  if (looseCount) parts.push(`${looseCount} ${looseCount === 1 ? "foto sciolta" : "foto sciolte"}`);
  return `Browser · ${parts.join(", ") || "foto"}`.slice(0, 255);
}
