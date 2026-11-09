import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { DriveClient } from "../src/lib/google-drive";
import { openDriveZip, zipEntries } from "../scripts/drive/zip-reader";

/** Zip minimo (senza zip64): voci "store" o "deflate". */
function makeZip(files: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const body = f.deflate ? deflateRawSync(f.data) : f.data;
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nomi UTF-8
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(f.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Finto Drive che serve un buffer e conta le richieste. */
function fakeDrive(zip: Buffer) {
  const calls: [number, number][] = [];
  const client = {
    async download(_id: string, range?: { start: number; end: number }) {
      const { start, end } = range ?? { start: 0, end: zip.length };
      calls.push([start, end]);
      return new Response(new Uint8Array(zip.subarray(start, end)));
    },
  } as unknown as DriveClient;
  return { client, calls };
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

describe("zip letto a pezzi da Drive", () => {
  it("elenca le voci ed estrae il contenuto, anche compresso", async () => {
    const photo = Buffer.alloc(300_000, 7);
    const json = Buffer.from(JSON.stringify({ title: "IMG_1.jpg", photoTakenTime: { timestamp: "1700000000" } }));
    const zipBuf = makeZip([
      { name: "Takeout/Google Foto/Vacanze/IMG_1.jpg", data: photo },
      { name: "Takeout/Google Foto/Vacanze/IMG_1.jpg.json", data: json, deflate: true },
    ]);
    const { client, calls } = fakeDrive(zipBuf);
    const zip = await openDriveZip(client, "id", zipBuf.length);
    const entries = await zipEntries(zip);
    expect(entries.map((e) => e.fileName)).toEqual([
      "Takeout/Google Foto/Vacanze/IMG_1.jpg",
      "Takeout/Google Foto/Vacanze/IMG_1.jpg.json",
    ]);
    // L'indice si legge con poche richieste a blocchi, non una per lettura.
    expect(calls.length).toBeLessThanOrEqual(2);

    expect((await readAll(await zip.openReadStreamPromise(entries[1]))).equals(json)).toBe(true);
    expect((await readAll(await zip.openReadStreamPromise(entries[0]))).equals(photo)).toBe(true);
    zip.close();
  });
});
