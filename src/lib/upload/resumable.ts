/*
 * Caricamento riprendibile su Google Cloud Storage dal browser.
 *
 * Il server apre la sessione (POST .../original) e dà l'indirizzo; qui si
 * manda il file a pezzi con PUT e Content-Range. Google risponde 308 con
 * l'header Range (byte ricevuti) finché manca qualcosa, 200/201 alla fine.
 * Se la rete cade si chiede a Google a che punto è ("bytes * /totale") e si
 * riparte da lì. Una sessione scaduta (404/410) va riaperta dal server.
 * Docs: https://cloud.google.com/storage/docs/performing-resumable-uploads
 *
 * La logica non tocca il browser: la richiesta HTTP arriva da fuori
 * (`send`), così i test la provano con un finto server.
 */

/** 8 MiB: multiplo di 256 KiB, come chiede Cloud Storage. */
export const CHUNK_SIZE = 8 * 1024 * 1024;

export type SendResult = { status: number; header(name: string): string | null };

export type Send = (req: {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  body: Blob | null;
  /** Byte del corpo inviati finora (per la barra). */
  onProgress?: (sent: number) => void;
}) => Promise<SendResult>;

export class SessionExpired extends Error {
  constructor() {
    super("La sessione di caricamento è scaduta.");
  }
}

export class Aborted extends Error {
  constructor() {
    super("Caricamento in pausa.");
  }
}

/** Byte già ricevuti da Google, dall'header Range "bytes=0-1234" (assente = 0). */
export function receivedFromRange(range: string | null): number {
  const m = /bytes=0-(\d+)/.exec(range ?? "");
  return m ? Number(m[1]) + 1 : 0;
}

/** Attesa prima del tentativo n (0, 1, 2…): 1, 2, 4… secondi, al massimo 60. */
export function retryDelayMs(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** attempt);
}

export type ResumableOptions = {
  url: string;
  file: Blob;
  send: Send;
  /** Totale dei byte arrivati a Google (anche quelli di una sessione precedente). */
  onProgress?: (received: number) => void;
  /** Tentativi di fila senza progressi prima di arrendersi. */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  isAborted?: () => boolean;
  chunkSize?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isDone(status: number) {
  return status === 200 || status === 201;
}

/**
 * Carica `file` nella sessione `url`, ripartendo da dove era arrivata.
 * Lancia SessionExpired se la sessione non vale più, Aborted se messo in
 * pausa, o l'ultimo errore dopo troppi tentativi falliti.
 */
export async function uploadResumable(opts: ResumableOptions): Promise<void> {
  const { url, file, send } = opts;
  const total = file.size;
  const chunk = opts.chunkSize ?? CHUNK_SIZE;
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? 8;
  const aborted = () => opts.isAborted?.() === true;

  /** Chiede a Google quanti byte ha: null = file già completo. */
  async function status(): Promise<number | null> {
    const res = await send({ method: "PUT", url, headers: { "Content-Range": `bytes */${total}` }, body: null });
    if (isDone(res.status)) return null;
    if (res.status === 308) return receivedFromRange(res.header("Range"));
    if (res.status === 404 || res.status === 410) throw new SessionExpired();
    throw new Error(`Cloud Storage ha risposto ${res.status} alla richiesta di stato.`);
  }

  let failures = 0;
  let offset: number | null = await statusWithRetry();
  while (offset !== null) {
    if (aborted()) throw new Aborted();
    opts.onProgress?.(offset);
    const end = Math.min(offset + chunk, total);
    const base = offset;
    try {
      const res = await send({
        method: "PUT",
        url,
        // File vuoto: si chiude la sessione con "bytes */0".
        headers: { "Content-Range": total === 0 ? "bytes */0" : `bytes ${base}-${end - 1}/${total}` },
        body: file.slice(base, end),
        onProgress: (sent) => opts.onProgress?.(base + sent),
      });
      if (isDone(res.status)) {
        opts.onProgress?.(total);
        return;
      }
      if (res.status === 308) {
        const next = receivedFromRange(res.header("Range"));
        if (next > base) failures = 0;
        offset = next;
        continue;
      }
      if (res.status === 404 || res.status === 410) throw new SessionExpired();
      if (res.status < 500 && res.status !== 408 && res.status !== 429) {
        throw new Error(`Cloud Storage ha rifiutato il caricamento (HTTP ${res.status}).`);
      }
      throw new RetryableError(`HTTP ${res.status}`);
    } catch (e) {
      if (e instanceof SessionExpired || e instanceof Aborted || !(e instanceof RetryableError || e instanceof NetworkError)) {
        throw e;
      }
      if (aborted()) throw new Aborted();
      if (failures >= maxRetries) throw new Error(`Caricamento non riuscito dopo ${maxRetries} tentativi (${e.message}).`);
      await sleep(retryDelayMs(failures));
      failures++;
      // Dopo un errore non si sa quanto è arrivato: lo si chiede.
      offset = await statusWithRetry();
    }
  }
  opts.onProgress?.(total);

  async function statusWithRetry(): Promise<number | null> {
    for (;;) {
      try {
        return await status();
      } catch (e) {
        if (!(e instanceof NetworkError) || failures >= maxRetries) throw e;
        if (aborted()) throw new Aborted();
        await sleep(retryDelayMs(failures));
        failures++;
      }
    }
  }
}

/** Errore temporaneo del server (5xx, 408, 429): si riprova. */
export class RetryableError extends Error {}

/** La richiesta non è arrivata (rete giù, connessione chiusa): si riprova. */
export class NetworkError extends Error {
  constructor(message = "Connessione interrotta.") {
    super(message);
  }
}
