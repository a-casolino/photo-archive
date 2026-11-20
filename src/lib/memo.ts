/*
 * Piccola cache in memoria del processo Node, con scadenza e etichette.
 *
 * Si salva la promessa (non il risultato) appena parte il caricamento: le
 * richieste contemporanee sulla stessa voce fanno una sola query, e una voce
 * svuotata mentre la query è in corso non torna in cache con dati vecchi.
 * Le etichette ("album", "volti") permettono di svuotare insieme tutte le
 * voci che dipendono dagli stessi dati (vedi src/lib/cache.ts).
 */

type Entry = { at: number; value: Promise<unknown>; tags: readonly string[] };

const g = globalThis as { __memo?: Map<string, Entry> };

/** Oltre questo numero di voci si eliminano le più vecchie. */
export const MAX_MEMO_ENTRIES = 20000;

function cache(): Map<string, Entry> {
  return (g.__memo ??= new Map());
}

export async function memo<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  now = Date.now(),
  tags: readonly string[] = [],
): Promise<T> {
  const c = cache();
  const hit = c.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  c.delete(key); // reinserita in fondo: l'ordine della Map è dal più vecchio
  c.set(key, { at: now, value, tags });
  if (c.size > MAX_MEMO_ENTRIES) {
    const oldest = c.keys().next().value;
    if (oldest !== undefined) c.delete(oldest);
  }
  // Un errore non resta in cache: la prossima richiesta riprova.
  value.catch(() => {
    if (c.get(key)?.value === value) c.delete(key);
  });
  return value;
}

/** C'è una voce valida per `key`? (senza caricarla) */
export function isFresh(key: string, ttlMs: number, now = Date.now()): boolean {
  const hit = g.__memo?.get(key);
  return !!hit && now - hit.at < ttlMs;
}

export function forget(key: string): void {
  g.__memo?.delete(key);
}

/** Svuota tutte le voci con almeno una di queste etichette; dice quante. */
export function forgetTags(tags: Iterable<string>): number {
  const wanted = new Set(tags);
  if (!g.__memo || !wanted.size) return 0;
  let n = 0;
  for (const [key, e] of g.__memo) {
    if (e.tags.some((t) => wanted.has(t))) {
      g.__memo.delete(key);
      n++;
    }
  }
  return n;
}

/** Svuota tutta la cache; dice quante voci c'erano. */
export function forgetAll(): number {
  const n = g.__memo?.size ?? 0;
  g.__memo?.clear();
  return n;
}

export type MemoSummary = { tag: string; entries: number; oldestAt: number | null };

/** Quante voci per etichetta (le voci senza etichetta sotto "altro") e da quando. */
export function memoSummary(): MemoSummary[] {
  const byTag = new Map<string, MemoSummary>();
  for (const e of g.__memo?.values() ?? []) {
    for (const tag of e.tags.length ? e.tags : ["altro"]) {
      const s = byTag.get(tag) ?? { tag, entries: 0, oldestAt: null };
      s.entries++;
      s.oldestAt = s.oldestAt === null ? e.at : Math.min(s.oldestAt, e.at);
      byTag.set(tag, s);
    }
  }
  return [...byTag.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}
