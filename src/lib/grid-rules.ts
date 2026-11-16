/*
 * Regole della griglia che si allunga mentre si scorre (pagina dell'album,
 * condivisioni e link liberi): quante foto per blocco e come si riprende la
 * posizione tornando indietro da una foto. Niente accesso al database qui.
 */

/** Foto del primo blocco (disegnato dal server) e di ogni blocco successivo. */
export const GRID_BATCH = 60;

/** Massimo di foto per una sola richiesta (anche per riprendere la posizione). */
export const GRID_MAX = 600;

/** Per quanto tempo vale la posizione salvata aprendo una foto. */
export const GRID_RESTORE_MAX_AGE_MS = 30 * 60 * 1000;

/** `da` e `n` dall'URL della richiesta: interi, `n` tra 1 e GRID_MAX. */
export function parseBatch(da: string | null, n: string | null): { offset: number; limit: number } {
  const offset = Math.max(0, Math.floor(Number(da)) || 0);
  const want = Math.floor(Number(n)) || GRID_BATCH;
  return { offset, limit: Math.min(GRID_MAX, Math.max(1, want)) };
}

/** Posizione salvata nel browser quando si apre una foto dalla griglia. */
export type GridSpot = { count: number; y: number; at: number };

/**
 * Quante foto caricare in più per tornare dove si era: 0 se la posizione è
 * vecchia, non valida o già coperta dal primo blocco.
 */
export function restoreCount(spot: unknown, loaded: number, total: number, now: number): number {
  if (!spot || typeof spot !== "object") return 0;
  const { count, at } = spot as Partial<GridSpot>;
  if (typeof count !== "number" || typeof at !== "number") return 0;
  if (now - at > GRID_RESTORE_MAX_AGE_MS || at > now) return 0;
  const target = Math.min(count, total);
  return Math.max(0, Math.min(GRID_MAX, target - loaded));
}
