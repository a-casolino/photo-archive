import type { PickedFile } from "./plan";

/*
 * File scelti nel browser: dal trascinamento (anche cartelle intere, con le
 * sottocartelle) o dai pulsanti "Scegli foto" / "Scegli cartella".
 */

/** Dai pulsanti: con "Scegli cartella" ogni file ha il percorso relativo (webkitRelativePath). */
export function filesFromInput(list: FileList | null): PickedFile[] {
  return Array.from(list ?? [], (file) => ({ file, path: file.webkitRelativePath || file.name }));
}

/**
 * Dal trascinamento. Le voci vanno lette subito, dentro l'evento drop (dopo
 * il browser le svuota); poi si visitano le cartelle con calma.
 */
export function entriesFromDrop(dt: DataTransfer): { entries: FileSystemEntry[]; files: File[] } {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  return { entries, files: Array.from(dt.files ?? []) };
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** Tutte le voci di una cartella: readEntries ne dà al massimo 100 per volta. */
async function readAll(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const out: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return out;
    out.push(...batch);
  }
}

export async function filesFromEntries(
  dropped: { entries: FileSystemEntry[]; files: File[] },
  onProgress?: (n: number) => void,
): Promise<PickedFile[]> {
  // Browser senza webkitGetAsEntry: solo i file, senza cartelle.
  if (dropped.entries.length === 0) return dropped.files.map((file) => ({ file, path: file.name }));
  const out: PickedFile[] = [];
  async function walk(entry: FileSystemEntry) {
    if (entry.isFile) {
      out.push({ file: await fileOf(entry as FileSystemFileEntry), path: entry.fullPath.replace(/^\/+/, "") });
      if (out.length % 200 === 0) onProgress?.(out.length);
    } else if (entry.isDirectory) {
      for (const child of await readAll(entry as FileSystemDirectoryEntry)) await walk(child);
    }
  }
  for (const e of dropped.entries) await walk(e);
  onProgress?.(out.length);
  return out;
}
