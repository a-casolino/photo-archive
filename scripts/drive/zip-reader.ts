import { PassThrough, Readable } from "node:stream";
import yauzl from "yauzl";
import type { DriveClient } from "../../src/lib/google-drive";

/*
 * Legge uno zip che sta su Google Drive a pezzi (richieste HTTP con Range),
 * senza scaricarlo tutto: così la VPS non deve tenere sul disco zip da 10 GB.
 *
 * yauzl legge l'indice dello zip e le intestazioni dei file con tante
 * letture piccole: queste passano da una cache a blocchi di 64 KB, così
 * l'indice di uno zip con decine di migliaia di foto costa poche decine di
 * richieste. Il contenuto dei file invece arriva con una richiesta ciascuno.
 */

const BLOCK = 64 * 1024;
const MAX_BLOCKS = 16;

class DriveRangeReader extends yauzl.RandomAccessReader {
  private blocks = new Map<number, Promise<Buffer>>();

  constructor(
    private readonly client: DriveClient,
    private readonly fileId: string,
    private readonly size: number,
  ) {
    super();
  }

  _readStreamForRange(start: number, end: number): Readable {
    const out = new PassThrough();
    this.client
      .download(this.fileId, { start, end })
      .then((res) => {
        if (!res.body) throw new Error("Drive: risposta vuota");
        const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
        body.on("error", (e) => out.destroy(e));
        body.pipe(out);
      })
      .catch((e: Error) => out.destroy(e));
    return out;
  }

  read(buffer: Buffer, offset: number, length: number, position: number, callback: (err: Error | null) => void): void {
    if (length > BLOCK) {
      super.read(buffer, offset, length, position, callback);
      return;
    }
    this.readCached(position, length).then(
      (data) => {
        data.copy(buffer, offset);
        callback(null);
      },
      (e: Error) => callback(e),
    );
  }

  private async readCached(position: number, length: number): Promise<Buffer> {
    const first = Math.floor(position / BLOCK);
    const last = Math.floor((position + length - 1) / BLOCK);
    const parts: Buffer[] = [];
    for (let i = first; i <= last; i++) parts.push(await this.block(i));
    const all = parts.length === 1 ? parts[0] : Buffer.concat(parts);
    const from = position - first * BLOCK;
    if (all.length < from + length) throw new Error("Drive: zip più corto del previsto");
    return all.subarray(from, from + length);
  }

  private block(i: number): Promise<Buffer> {
    let p = this.blocks.get(i);
    if (!p) {
      const start = i * BLOCK;
      const end = Math.min(this.size, start + BLOCK);
      p = this.client.download(this.fileId, { start, end }).then(async (res) => Buffer.from(await res.arrayBuffer()));
      p.catch(() => this.blocks.delete(i));
      this.blocks.set(i, p);
      if (this.blocks.size > MAX_BLOCKS) this.blocks.delete(this.blocks.keys().next().value!);
    }
    return p;
  }
}

/** Apre uno zip di Drive. Chiudere con `zip.close()` quando non serve più. */
export function openDriveZip(client: DriveClient, fileId: string, size: number): Promise<yauzl.ZipFile> {
  return yauzl.fromRandomAccessReaderPromise(new DriveRangeReader(client, fileId, size), size, {
    lazyEntries: true,
    autoClose: false,
  });
}

/** Tutte le voci dello zip (solo l'indice, nessun contenuto). */
export async function zipEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  const out: yauzl.Entry[] = [];
  for await (const entry of zip.eachEntry()) out.push(entry);
  return out;
}
