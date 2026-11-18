/*
 * Piccola cache in memoria del processo Node, con scadenza: per dati che
 * cambiano di rado e si leggono a ogni pagina (anni delle foto per i filtri).
 * Un valore vecchio di qualche minuto non fa danni; chi cambia i dati può
 * comunque svuotare la voce con forget().
 */

type Entry = { at: number; value: Promise<unknown> };

const g = globalThis as { __memo?: Map<string, Entry> };

export async function memo<T>(key: string, ttlMs: number, load: () => Promise<T>, now = Date.now()): Promise<T> {
  const cache = (g.__memo ??= new Map());
  const hit = cache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: now, value });
  // Un errore non resta in cache: la prossima richiesta riprova.
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

export function forget(key: string): void {
  g.__memo?.delete(key);
}
