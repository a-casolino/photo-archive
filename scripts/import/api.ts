import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { UploadTarget } from "../../src/lib/import-shared";

/** Chiamate all'app (API /api/import/v1) e upload dei file. */

export class FatalError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ritenta su errori di rete e 5xx, con attese crescenti. */
async function withRetry<T>(what: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof FatalError || (e as { retry?: boolean }).retry === false) throw e;
      last = e;
      if (i < attempts - 1) await sleep(1000 * 2 ** i);
    }
  }
  throw new Error(`${what}: ${(last as Error)?.message ?? last}`);
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retry: boolean,
  ) {
    super(message);
  }
}

export class Api {
  constructor(
    readonly server: string,
    private readonly key: string,
  ) {}

  async call<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    return withRetry(`${method} ${pathname}`, async () => {
      const res = await fetch(new URL(`/api/import/v1${pathname}`, this.server), {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 401) throw new FatalError(data.error ?? "Chiave non valida.");
      if (!res.ok) throw new HttpError(data.error ?? `HTTP ${res.status}`, res.status, res.status >= 500);
      return data as T;
    });
  }

  /**
   * Carica un file (percorso) o un buffer su un URL firmato. `onBytes`
   * riceve i byte man mano che partono (per velocità e avanzamento);
   * `onRetry` viene chiamato prima di ogni nuovo tentativo.
   */
  async upload(
    target: UploadTarget,
    data: { file: string; size: number } | Buffer,
    progress?: { onBytes?: (n: number) => void; onRetry?: () => void },
  ): Promise<void> {
    let attempt = 0;
    await withRetry("upload", async () => {
      if (attempt++ > 0) progress?.onRetry?.();
      const isBuf = Buffer.isBuffer(data);
      let body: BodyInit;
      if (isBuf) {
        body = new Uint8Array(data) as Uint8Array<ArrayBuffer>;
      } else {
        const stream = createReadStream(data.file);
        if (progress?.onBytes) stream.on("data", (chunk) => progress.onBytes!(chunk.length));
        body = Readable.toWeb(stream) as ReadableStream;
      }
      const res = await fetch(new URL(target.url, this.server), {
        method: target.method,
        headers: { ...target.headers, "Content-Length": String(isBuf ? data.length : data.size) },
        body,
        // @ts-expect-error -- richiesto da Node per i body in streaming
        duplex: "half",
      });
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 300);
        throw new HttpError(`upload rifiutato (HTTP ${res.status}) ${text}`, res.status, res.status >= 500 || res.status === 429);
      }
      if (isBuf) progress?.onBytes?.(data.length);
    });
  }
}
