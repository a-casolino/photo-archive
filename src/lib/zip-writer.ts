import { crc32 } from "node:zlib";

/*
 * Scrittore ZIP in streaming, senza dipendenze e senza file temporanei:
 * ogni file viene letto a pezzi e mandato subito al browser, quindi la
 * memoria usata non dipende dalla grandezza dell'album.
 *
 * - Solo "store" (nessuna compressione): i JPEG sono già compressi, così la
 *   CPU della VPS fa solo il CRC32 (nativo in node:zlib).
 * - Le dimensioni e il CRC di ogni file vanno nel "data descriptor" dopo i
 *   dati (bit 3), perché si conoscono solo alla fine della lettura.
 * - ZIP64 solo quando serve: oltre 4 GB di archivio o 65.535 file. Ogni
 *   singolo file deve restare sotto i 4 GB (le anteprime sono pochi MB).
 * - Nomi in UTF-8 (bit 11), così "Città" resta "Città" anche su Windows.
 */

export type ZipEntry = {
  /** Percorso dentro lo ZIP, con "/" come separatore. */
  name: string;
  /** Data e ora del file, già nell'ora locale da mostrare (vedi dosDateTime). */
  date: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  } | null;
  /** Apre il contenuto. null = file non disponibile, si salta. */
  open: () => Promise<AsyncIterable<Uint8Array> | null>;
};

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const FLAGS = 0x0008 | 0x0800; // data descriptor + nomi UTF-8

type Written = {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
};

/** Data e ora nel formato MS-DOS (dal 1980; prima si usa il 1/1/1980). */
export function dosDateTime(d: ZipEntry["date"]): {
  date: number;
  time: number;
} {
  if (!d || d.year < 1980) return { date: (0 << 9) | (1 << 5) | 1, time: 0 };
  const year = Math.min(d.year, 2107);
  return {
    date: ((year - 1980) << 9) | (d.month << 5) | d.day,
    time: (d.hour << 11) | (d.minute << 5) | Math.floor(d.second / 2),
  };
}

/**
 * Le parti dello ZIP, una dopo l'altra. Chi la consuma decide il ritmo:
 * finché non chiede il pezzo successivo non si legge altro.
 * `opts.forceZip64` serve solo ai test.
 */
export async function* zipStream(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
  opts: { forceZip64?: boolean; onSkip?: (name: string) => void } = {},
): AsyncGenerator<Uint8Array> {
  const written: Written[] = [];
  let offset = 0;

  for await (const entry of entries) {
    const body = await entry.open();
    if (!body) {
      opts.onSkip?.(entry.name);
      continue;
    }
    const name = Buffer.from(entry.name, "utf8");
    const { date, time } = dosDateTime(entry.date);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versione necessaria: 2.0
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    // CRC e dimensioni a zero: arrivano nel data descriptor.
    local.writeUInt16LE(name.length, 26);
    const start = offset;
    yield local;
    yield name;
    offset += local.length + name.length;

    let crc = 0;
    let size = 0;
    for await (const chunk of body) {
      crc = crc32(chunk, crc);
      size += chunk.length;
      yield chunk;
    }
    if (size > MAX32) throw new Error(`File troppo grande per lo ZIP: ${entry.name}`);
    offset += size;

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc >>> 0, 4);
    descriptor.writeUInt32LE(size, 8);
    descriptor.writeUInt32LE(size, 12);
    yield descriptor;
    offset += descriptor.length;

    written.push({ name, crc: crc >>> 0, size, offset: start, time, date });
  }

  // Indice centrale.
  const cdStart = offset;
  for (const w of written) {
    const big = opts.forceZip64 || w.offset >= MAX32;
    const extra = big ? Buffer.alloc(12) : Buffer.alloc(0);
    if (big) {
      extra.writeUInt16LE(0x0001, 0); // extra ZIP64
      extra.writeUInt16LE(8, 2);
      extra.writeBigUInt64LE(BigInt(w.offset), 4);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | (big ? 45 : 20), 4); // creato su Unix
    central.writeUInt16LE(big ? 45 : 20, 6);
    central.writeUInt16LE(FLAGS, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(w.time, 12);
    central.writeUInt16LE(w.date, 14);
    central.writeUInt32LE(w.crc, 16);
    central.writeUInt32LE(w.size, 20);
    central.writeUInt32LE(w.size, 24);
    central.writeUInt16LE(w.name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // permessi rw-r--r--
    central.writeUInt32LE(big ? MAX32 : w.offset, 42);
    yield central;
    yield w.name;
    if (extra.length) yield extra;
    offset += central.length + w.name.length + extra.length;
  }
  const cdSize = offset - cdStart;
  const count = written.length;

  const zip64 = opts.forceZip64 || count >= MAX16 || cdStart >= MAX32 || cdSize >= MAX32;
  if (zip64) {
    const eocd64 = Buffer.alloc(56);
    eocd64.writeUInt32LE(0x06064b50, 0);
    eocd64.writeBigUInt64LE(BigInt(44), 4); // dimensione del record dopo questo campo
    eocd64.writeUInt16LE((3 << 8) | 45, 12);
    eocd64.writeUInt16LE(45, 14);
    eocd64.writeBigUInt64LE(BigInt(count), 24);
    eocd64.writeBigUInt64LE(BigInt(count), 32);
    eocd64.writeBigUInt64LE(BigInt(cdSize), 40);
    eocd64.writeBigUInt64LE(BigInt(cdStart), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset), 8);
    locator.writeUInt32LE(1, 16);
    yield eocd64;
    yield locator;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(zip64 ? MAX16 : count, 8);
  eocd.writeUInt16LE(zip64 ? MAX16 : count, 10);
  eocd.writeUInt32LE(zip64 ? MAX32 : cdSize, 12);
  eocd.writeUInt32LE(zip64 ? MAX32 : cdStart, 16);
  yield eocd;
}

/** Un nome valido come cartella o file su Windows, macOS e Linux. */
export function safeZipName(raw: string, fallback: string): string {
  const clean = raw
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 120)
    .trim();
  return clean || fallback;
}

/**
 * Nomi unici dentro ogni cartella: il secondo "IMG_0001.jpg" diventa
 * "IMG_0001 (2).jpg" (senza badare a maiuscole, come Windows e macOS).
 */
export function uniqueNamer(): (folder: string, file: string) => string {
  const used = new Set<string>();
  return (folder, file) => {
    const dot = file.lastIndexOf(".");
    const stem = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : "";
    let name = file;
    for (let n = 2; used.has(`${folder}/${name}`.toLowerCase()); n++) name = `${stem} (${n})${ext}`;
    used.add(`${folder}/${name}`.toLowerCase());
    return folder ? `${folder}/${name}` : name;
  };
}
