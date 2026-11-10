/*
 * URL firmati "stabili" per le anteprime.
 *
 * Un URL firmato contiene l'ora della firma: se ogni pagina firma di nuovo
 * le miniature, gli URL cambiano a ogni visita e il browser riscarica tutte
 * le immagini (la sua cache è per URL). Firmando con un'ora arrotondata alla
 * finestra (es. l'ora intera) lo stesso file ha lo stesso URL per tutta la
 * finestra, e il browser lo prende dalla cache o lo riconvalida con un 304.
 */

/** Finestra di firma: dentro la stessa finestra l'URL di un file non cambia. */
export const SIGN_WINDOW_SECONDS = 3600;

/**
 * Inizio validità e scadenza (in ms) di un URL firmato alle `nowMs`: inizio
 * all'ultimo multiplo di `windowSeconds`, scadenza dopo la fine della finestra
 * più `ttlSeconds`, così chi lo riceve ha sempre almeno `ttlSeconds` per usarlo.
 */
export function stableSignWindow(
  nowMs: number,
  ttlSeconds: number,
  windowSeconds: number = SIGN_WINDOW_SECONDS,
): { accessibleAt: number; expires: number } {
  const w = windowSeconds * 1000;
  const accessibleAt = Math.floor(nowMs / w) * w;
  return { accessibleAt, expires: accessibleAt + w + ttlSeconds * 1000 };
}
