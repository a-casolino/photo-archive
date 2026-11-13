/*
 * Regole della presentazione (slideshow) di un album: pure, senza browser né
 * database, così si provano nei test. Usate da slideshow.tsx e dall'API
 * /api/presentazione.
 */

/** Risposta di /api/presentazione: un blocco di foto dalla `offset`. */
export type SlideshowResponse = {
  total: number;
  offset: number;
  slides: Slide[];
};

export type Slide = {
  id: string;
  /** URL firmato dell'anteprima grande (null se l'archivio non è raggiungibile). */
  src: string | null;
  /** Titolo o nome del file. */
  name: string;
  takenAt: string | null;
};

/** Secondi per foto proposti nel menu. */
export const SLIDE_INTERVALS = [3, 5, 8, 15, 30] as const;
export const DEFAULT_INTERVAL = 5;

/**
 * Transizione tra una foto e l'altra (scelta del 2026-11-13). Sul Chromecast
 * non vale: la TV usa la dissolvenza del ricevitore di Google.
 */
export const SLIDE_TRANSITIONS = [
  { id: "dissolvenza", label: "Dissolvenza" },
  { id: "scorrimento", label: "Scorrimento" },
  { id: "zoom", label: "Zoom lento" },
  { id: "nessuna", label: "Nessuna" },
] as const;
export type SlideTransition = (typeof SLIDE_TRANSITIONS)[number]["id"];
export const DEFAULT_TRANSITION: SlideTransition = "dissolvenza";

/** Transizione letta dalle preferenze salvate; se sconosciuta, quella di base. */
export function parseTransition(value: unknown): SlideTransition {
  return SLIDE_TRANSITIONS.find((t) => t.id === value)?.id ?? DEFAULT_TRANSITION;
}

/** Foto per richiesta all'API: le successive arrivano mentre la presentazione va avanti. */
export const SLIDE_BATCH = 100;

/**
 * Durata degli URL firmati della presentazione. La TV (Chromecast) scarica
 * la foto quando la riceve, ma una presentazione può restare in pausa a lungo:
 * gli URL valgono 3 ore e il browser richiede il blocco dopo 90 minuti.
 */
export const SLIDE_URL_TTL_SECONDS = 3 * 3600;
export const SLIDE_BATCH_MAX_AGE_MS = 90 * 60 * 1000;

/** Intervallo letto dalle preferenze salvate; se non è tra quelli proposti, quello di base. */
export function parseInterval(value: unknown): number {
  const n = Number(value);
  return (SLIDE_INTERVALS as readonly number[]).includes(n) ? n : DEFAULT_INTERVAL;
}

/**
 * Indice della foto dopo `step` passi (+1 avanti, -1 indietro). A fine album
 * ricomincia dall'inizio; tornando indietro dalla prima va all'ultima, ma solo
 * se l'elenco è già tutto caricato (altrimenti resta sulla prima).
 */
export function stepIndex(index: number, step: 1 | -1, total: number, loaded: number): number {
  if (total <= 0) return 0;
  const next = index + step;
  if (next >= total) return 0;
  if (next < 0) return loaded >= total ? total - 1 : 0;
  return next;
}

/** Blocco (offset dell'API) che contiene la foto `index`. */
export function batchOf(index: number, size: number = SLIDE_BATCH): number {
  return Math.floor(Math.max(0, index) / size) * size;
}

/** Blocchi da chiedere per mostrare `index`: il suo e, verso la fine del blocco, il successivo. */
export function batchesFor(index: number, total: number, size: number = SLIDE_BATCH): number[] {
  const cur = batchOf(index, size);
  const out = [cur];
  const next = cur + size;
  if (next < total && index >= next - 10) out.push(next);
  // A fine album si riparte dall'inizio: il primo blocco serve pronto.
  if (total > size && index >= total - 10 && cur !== 0) out.push(0);
  return out;
}

/** Il blocco caricato alle `fetchedAt` ha ancora URL buoni? */
export function batchFresh(fetchedAt: number, now: number): boolean {
  return now - fetchedAt < SLIDE_BATCH_MAX_AGE_MS;
}

/** Il browser può usare Google Cast (Chrome o Edge su computer e Android; mai su iPhone e iPad). */
export function castSupported(userAgent: string, maxTouchPoints = 0): boolean {
  const ios = /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (ios) return false;
  // Firefox e Safari non hanno Cast; Chrome, Edge e gli altri Chromium sì.
  if (/Firefox|FxiOS/.test(userAgent)) return false;
  return /Chrome\/|CriOS|Edg\//.test(userAgent);
}
