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

// ---------------------------------------------------------------------
// File System Access (Chrome ed Edge sul computer)
// ---------------------------------------------------------------------
/*
 * Con queste API il browser dà dei "riferimenti" a file e cartelle che si
 * possono conservare (IndexedDB, src/lib/upload/saved.ts): riaprendo la
 * pagina si riprende il caricamento chiedendo solo il permesso di lettura,
 * senza riscegliere la cartella. Safari, Firefox e i telefoni non le hanno:
 * lì restano i pulsanti normali.
 */

type PermissionHandle = FileSystemHandle & {
  queryPermission?(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" }): Promise<PermissionState>;
};
type DirectoryWithValues = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };
type PickerWindow = Window & {
  showDirectoryPicker?(o?: { mode?: "read"; id?: string }): Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?(o?: {
    multiple?: boolean;
    id?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }): Promise<FileSystemFileHandle[]>;
};
type ItemWithHandle = DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> };

/** Il browser sa dare riferimenti a cartelle da conservare (Chrome, Edge sul computer). */
export function canKeepHandles(): boolean {
  return typeof window !== "undefined" && typeof (window as PickerWindow).showDirectoryPicker === "function";
}

function cancelled(e: unknown): boolean {
  return (e as DOMException)?.name === "AbortError";
}

/** "Scegli cartella" con il selettore di Chrome/Edge. null = annullato. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await (window as PickerWindow).showDirectoryPicker!({ mode: "read", id: "carica-cartella" })) ?? null;
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

/** "Scegli foto" con il selettore di Chrome/Edge. null = annullato o selettore assente. */
export async function pickFiles(): Promise<FileSystemFileHandle[] | null> {
  const w = window as PickerWindow;
  if (typeof w.showOpenFilePicker !== "function") return null;
  try {
    return await w.showOpenFilePicker({
      multiple: true,
      id: "carica-foto",
      types: [
        {
          description: "Foto",
          accept: { "image/*": [".cr2", ".dng", ".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".gif", ".tif", ".tiff"] },
        },
      ],
    });
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

/**
 * Riferimenti degli oggetti trascinati, da chiedere subito dentro l'evento
 * drop come le voci. Vuoto se il browser non li dà.
 */
export function handlesFromDrop(dt: DataTransfer): Promise<FileSystemHandle | null>[] {
  const out: Promise<FileSystemHandle | null>[] = [];
  for (const item of Array.from(dt.items ?? []) as ItemWithHandle[]) {
    if (item.kind !== "file" || typeof item.getAsFileSystemHandle !== "function") continue;
    out.push(item.getAsFileSystemHandle().then((h) => h ?? null, () => null));
  }
  return out;
}

/**
 * Permesso di lettura dei riferimenti conservati: va chiesto dopo un clic
 * ("Riprendi"). false se negato.
 */
export async function allowRead(handles: FileSystemHandle[]): Promise<boolean> {
  for (const h of handles as PermissionHandle[]) {
    if (!h.queryPermission || !h.requestPermission) continue;
    if ((await h.queryPermission({ mode: "read" })) === "granted") continue;
    if ((await h.requestPermission({ mode: "read" })) !== "granted") return false;
  }
  return true;
}

/** Tutti i file dentro i riferimenti (cartelle comprese), con il percorso dalla cartella scelta. */
export async function filesFromHandles(handles: FileSystemHandle[], onProgress?: (n: number) => void): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  async function walk(h: FileSystemHandle, path: string) {
    if (h.kind === "file") {
      out.push({ file: await (h as FileSystemFileHandle).getFile(), path });
      if (out.length % 200 === 0) onProgress?.(out.length);
    } else {
      for await (const child of (h as DirectoryWithValues).values()) await walk(child, `${path}/${child.name}`);
    }
  }
  for (const h of handles) await walk(h, h.name);
  onProgress?.(out.length);
  return out;
}
