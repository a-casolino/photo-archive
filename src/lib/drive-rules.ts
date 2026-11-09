/*
 * Regole dell'import da Google Drive senza dipendenze dal server (testate in
 * tests/drive-rules.test.ts): riconoscere gli zip di Google Takeout, nomi di
 * file sicuri, suddivisione in lotti.
 */

/** Nome della chiave di import usata da `npm run drive`: così la pagina Import sa che un import viene da Drive. */
export const DRIVE_DEVICE_NAME = "VPS · Google Drive";

export type DriveFileLite = { id: string; name: string; size: number; modifiedTime?: string };

export type TakeoutExport = {
  /** "takeout-20261109T083015Z": uguale per tutti gli zip dello stesso export. */
  key: string;
  createdAt: Date;
  parts: DriveFileLite[];
  bytes: number;
  /** true se l'export è in .tgz: per leggerlo a pezzi da Drive serve lo zip. */
  tgz: boolean;
};

const TAKEOUT_RE = /^(takeout-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z)(?:-\d+)*\.(zip|tgz|tar\.gz)$/i;

/** Raggruppa i file di Takeout per export (più recente prima), con le parti in ordine. */
export function groupTakeoutExports(files: readonly DriveFileLite[]): TakeoutExport[] {
  const groups = new Map<string, TakeoutExport>();
  for (const f of files) {
    const m = TAKEOUT_RE.exec(f.name);
    if (!m) continue;
    const key = m[1].toLowerCase();
    let g = groups.get(key);
    if (!g) {
      const createdAt = new Date(Date.UTC(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]));
      g = { key, createdAt, parts: [], bytes: 0, tgz: false };
      groups.set(key, g);
    }
    g.parts.push(f);
    g.bytes += f.size;
    if (m[8].toLowerCase() !== "zip") g.tgz = true;
  }
  for (const g of groups.values()) g.parts.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return [...groups.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Un nome di Drive (che può contenere "/" e caratteri strani) come nome di
 * cartella o file sul disco della VPS.
 */
export function safeSegment(name: string): string {
  const cleaned = name
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
    .trim()
    .replace(/^\.+/, "_");
  // Linux accetta nomi fino a 255 byte: si taglia lasciando l'estensione.
  let out = cleaned || "_";
  while (Buffer.byteLength(out) > 200) {
    const dot = out.lastIndexOf(".");
    const ext = dot > 0 && out.length - dot <= 10 ? out.slice(dot) : "";
    out = out.slice(0, Math.max(1, out.length - ext.length - 10)) + ext;
  }
  return out;
}

/** Nomi unici dentro la stessa cartella (su Drive due file possono chiamarsi uguale). */
export function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${stem} (${i})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Percorso di una voce di uno zip, controllato: niente percorsi assoluti né
 * "..". Restituisce i pezzi del percorso, o null se la voce va ignorata.
 */
export function zipEntrySegments(fileName: string): string[] | null {
  if (fileName.endsWith("/")) return null; // cartella
  const parts = fileName.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || fileName.startsWith("/") || parts.some((p) => p === "..")) return null;
  return parts.map(safeSegment);
}

/**
 * Divide i file in lotti di al massimo `maxBytes` (un file più grande del
 * limite fa un lotto da solo), mantenendo l'ordine.
 */
export function makeBatches<T extends { size: number }>(items: readonly T[], maxBytes: number): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    if (current.length > 0 && bytes + item.size > maxBytes) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += item.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
