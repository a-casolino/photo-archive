import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import yauzl from "yauzl";
import { dosDateTime, safeZipName, uniqueNamer, zipStream, type ZipEntry } from "../src/lib/zip-writer";

async function collect(gen: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const p of gen) parts.push(Buffer.from(p));
  return Buffer.concat(parts);
}

/** A pezzi, come arriverebbe da GCS. */
async function* chunks(data: Buffer, size = 7000): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < data.length; i += size) yield data.subarray(i, i + size);
}

function entry(name: string, data: Buffer | null, date: ZipEntry["date"] = null): ZipEntry {
  return { name, date, open: async () => (data ? chunks(data) : null) };
}

/** Legge lo ZIP con yauzl (lo stesso lettore usato per i Takeout) e controlla i CRC. */
function readZip(buf: Buffer): Promise<{ name: string; data: Buffer; date: Date }[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const out: { name: string; data: Buffer; date: Date }[] = [];
      zip.on("entry", (e: yauzl.Entry) => {
        zip.openReadStream(e, (err2, stream) => {
          if (err2 || !stream) return reject(err2);
          const parts: Buffer[] = [];
          stream.on("data", (c: Buffer) => parts.push(c));
          stream.on("end", () => {
            out.push({ name: e.fileName, data: Buffer.concat(parts), date: e.getLastModDate() });
            zip.readEntry();
          });
          stream.on("error", reject);
        });
      });
      zip.on("end", () => resolve(out));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

describe("zipStream", () => {
  const a = randomBytes(20_000);
  const b = randomBytes(1);
  const files = () => [
    entry("Città d'arte/IMG_0001.jpg", a, { year: 2014, month: 7, day: 12, hour: 18, minute: 30, second: 41 }),
    entry("Città d'arte/Altri scatti/IMG_0002.jpg", b),
    entry("Città d'arte/mancante.jpg", null),
  ];

  it("crea uno ZIP leggibile, con nomi UTF-8 e senza i file mancanti", async () => {
    const skipped: string[] = [];
    const zip = await collect(zipStream(files(), { onSkip: (n) => skipped.push(n) }));
    const read = await readZip(zip);
    expect(read.map((f) => f.name)).toEqual(["Città d'arte/IMG_0001.jpg", "Città d'arte/Altri scatti/IMG_0002.jpg"]);
    expect(read[0].data.equals(a)).toBe(true);
    expect(read[1].data.equals(b)).toBe(true);
    expect(skipped).toEqual(["Città d'arte/mancante.jpg"]);
    // Data del file: quella dello scatto (secondi pari, formato MS-DOS).
    const d = read[0].date;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([
      2014, 7, 12, 18, 30, 40,
    ]);
  });

  it("scrive anche i record ZIP64 (per gli album oltre 4 GB)", async () => {
    const zip = await collect(zipStream(files(), { forceZip64: true }));
    expect(zip.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(true);
    const read = await readZip(zip);
    expect(read).toHaveLength(2);
    expect(read[0].data.equals(a)).toBe(true);
  });

  it("uno ZIP vuoto è comunque valido", async () => {
    const zip = await collect(zipStream([]));
    expect(zip.length).toBe(22);
    expect(await readZip(zip)).toEqual([]);
  });

  it("si ferma quando chi scarica interrompe", async () => {
    let opened = 0;
    const many = Array.from({ length: 5 }, (_, i) => ({
      name: `f${i}.jpg`,
      date: null,
      open: async () => {
        opened++;
        return chunks(a);
      },
    }));
    const gen = zipStream(many);
    await gen.next();
    await gen.return(undefined);
    expect(opened).toBe(1);
  });
});

describe("dosDateTime", () => {
  it("prima del 1980 usa il 1/1/1980", () => {
    expect(dosDateTime({ year: 1975, month: 5, day: 3, hour: 1, minute: 2, second: 3 })).toEqual({
      date: 33,
      time: 0,
    });
    expect(dosDateTime(null)).toEqual({ date: 33, time: 0 });
  });
});

describe("safeZipName", () => {
  it("toglie i caratteri non validi su Windows e i punti finali", () => {
    expect(safeZipName('Viaggio: Roma/Napoli? "2014"...', "Album")).toBe("Viaggio Roma Napoli 2014");
    expect(safeZipName("  ..  ", "Album")).toBe("Album");
    expect(safeZipName("Città", "x")).toBe("Città");
  });
});

describe("uniqueNamer", () => {
  it("rinomina i doppioni nella stessa cartella, senza badare alle maiuscole", () => {
    const name = uniqueNamer();
    expect(name("A", "IMG_1.jpg")).toBe("A/IMG_1.jpg");
    expect(name("A", "img_1.JPG")).toBe("A/img_1 (2).JPG");
    expect(name("A", "IMG_1.jpg")).toBe("A/IMG_1 (3).jpg");
    expect(name("B", "IMG_1.jpg")).toBe("B/IMG_1.jpg");
  });
});
