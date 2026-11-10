import { describe, expect, it } from "vitest";
import {
  Aborted,
  NetworkError,
  SessionExpired,
  receivedFromRange,
  uploadResumable,
  type Send,
} from "../src/lib/upload/resumable";

/**
 * Finto Cloud Storage: tiene i byte ricevuti e risponde come la sessione
 * riprendibile vera (308 + Range finché manca qualcosa, 200 alla fine).
 * `faults` decide cosa va storto alla richiesta n.
 */
function fakeGcs(total: number, faults: Record<number, "network" | "500" | "410" | "half"> = {}) {
  let received = 0;
  let n = 0;
  const log: string[] = [];
  const send: Send = async ({ headers, body }) => {
    const i = n++;
    const range = headers["Content-Range"];
    log.push(range);
    const fault = faults[i];
    if (fault === "network") throw new NetworkError();
    if (fault === "500") return { status: 503, header: () => null };
    if (fault === "410") return { status: 410, header: () => null };
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    if (m && body) {
      const start = Number(m[1]);
      expect(start).toBe(received); // mai buchi né sovrapposizioni
      // "half": Google ne ha salvati solo metà prima che cadesse la connessione.
      const got = fault === "half" ? Math.floor(body.size / 2) : body.size;
      received = start + got;
      if (fault === "half") throw new NetworkError();
    }
    if (received >= total) return { status: 200, header: () => null };
    return { status: 308, header: (h: string) => (h === "Range" && received > 0 ? `bytes=0-${received - 1}` : null) };
  };
  return { send, log, received: () => received };
}

const file = (size: number) => new Blob([new Uint8Array(size)]);
const noSleep = async () => {};

describe("receivedFromRange", () => {
  it("legge l'header Range di Google", () => {
    expect(receivedFromRange("bytes=0-1048575")).toBe(1048576);
    expect(receivedFromRange(null)).toBe(0);
  });
});

describe("uploadResumable", () => {
  it("manda il file a pezzi e finisce", async () => {
    const gcs = fakeGcs(25);
    const progress: number[] = [];
    await uploadResumable({ url: "u", file: file(25), send: gcs.send, chunkSize: 10, sleep: noSleep, onProgress: (p) => progress.push(p) });
    expect(gcs.log).toEqual(["bytes */25", "bytes 0-9/25", "bytes 10-19/25", "bytes 20-24/25"]);
    expect(progress.at(-1)).toBe(25);
  });

  it("riprende una sessione già a metà (pagina chiusa e riaperta)", async () => {
    const gcs = fakeGcs(25);
    await uploadResumable({ url: "u", file: file(25), send: gcs.send, chunkSize: 10, sleep: noSleep, isAborted: () => gcs.received() >= 10 }).catch(
      (e) => expect(e).toBeInstanceOf(Aborted),
    );
    expect(gcs.received()).toBe(10);
    gcs.log.length = 0;
    await uploadResumable({ url: "u", file: file(25), send: gcs.send, chunkSize: 10, sleep: noSleep });
    expect(gcs.log).toEqual(["bytes */25", "bytes 10-19/25", "bytes 20-24/25"]);
  });

  it("dopo un errore di rete chiede a Google a che punto è e riparte da lì", async () => {
    const gcs = fakeGcs(30, { 2: "half", 3: "network", 5: "500" });
    await uploadResumable({ url: "u", file: file(30), send: gcs.send, chunkSize: 10, sleep: noSleep });
    expect(gcs.received()).toBe(30);
    // 0-9 ok, 10-19 a metà (arrivano 5 byte), stato fallisce, stato ok, si riparte da 15.
    expect(gcs.log).toContain("bytes 15-24/30");
  });

  it("sessione scaduta: errore apposito, così il server ne apre un'altra", async () => {
    const gcs = fakeGcs(30, { 0: "410" });
    await expect(uploadResumable({ url: "u", file: file(30), send: gcs.send, sleep: noSleep })).rejects.toBeInstanceOf(SessionExpired);
  });

  it("file già completo: nessun byte da mandare", async () => {
    const gcs = fakeGcs(0);
    await uploadResumable({ url: "u", file: file(0), send: gcs.send, sleep: noSleep });
    expect(gcs.log).toEqual(["bytes */0"]);
  });

  it("si arrende dopo troppi errori di fila", async () => {
    const faults = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, "network" as const]));
    const gcs = fakeGcs(30, faults);
    await expect(uploadResumable({ url: "u", file: file(30), send: gcs.send, sleep: noSleep, maxRetries: 3 })).rejects.toThrow(
      /Connessione interrotta|tentativi/,
    );
  });
});
