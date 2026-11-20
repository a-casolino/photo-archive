import "server-only";
/*
 * Cache in memoria dei dati dell'archivio che cambiano di rado e costano
 * a MySQL (conteggi degli album, delle persone, dei volti).
 *
 * - Le voci durano CACHE_TTL_MS (7 giorni): l'archivio cambia poco.
 * - Ogni scrittura dall'app (db.ts: execute() e le transazioni) svuota
 *   subito le voci con l'etichetta della tabella scritta (cache-rules.ts).
 * - I programmi da riga di comando (volti, drive, cestino, impronte) sono
 *   processi separati: scrivendo aumentano il numero di versione
 *   dell'etichetta nella tabella cache_versions. Prima di leggere la cache
 *   l'app guarda quella tabella (al più una volta al secondo) e, se un
 *   numero è cambiato, svuota le voci di quell'etichetta.
 * - Il proprietario può svuotare tutto a mano da Statistiche.
 * Mai in cache dati legati a chi guarda o permessi: solo i conteggi
 * dell'archivio; i controlli di accesso restano a ogni richiesta.
 */
import type { CacheTag } from "./cache-rules";
import { pool } from "./db";
import { forgetAll, forgetTags, isFresh, memo, memoSummary, type MemoSummary } from "./memo";

export type { CacheTag } from "./cache-rules";

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VERSION_CHECK_MS = 1000;
const FLUSH_DELAY_MS = 2000;

type State = {
  /** Ultima versione vista per etichetta (in questo processo). */
  versions: Map<string, number>;
  checkedAt: number;
  checking: Promise<void> | null;
  /** Etichette da segnalare agli altri processi (aumentando la versione). */
  pending: Set<CacheTag>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  warned: boolean;
};

const g = globalThis as { __cacheState?: State };
const state = (): State =>
  (g.__cacheState ??= {
    versions: new Map(),
    checkedAt: 0,
    checking: null,
    pending: new Set(),
    flushTimer: null,
    warned: false,
  });

function warnOnce(e: unknown) {
  const s = state();
  if (s.warned) return;
  s.warned = true;
  console.warn("[cache] tabella cache_versions non leggibile (migrazione 021 mancante?):", (e as Error).message);
}

/** Legge le versioni e svuota le etichette cambiate da un altro processo. */
async function syncVersions(): Promise<void> {
  const s = state();
  if (Date.now() - s.checkedAt < VERSION_CHECK_MS) return;
  s.checking ??= (async () => {
    try {
      const [rows] = await pool().query<(import("mysql2").RowDataPacket & { tag: string; version: number })[]>(
        "SELECT tag, version FROM cache_versions",
      );
      const changed: string[] = [];
      for (const r of rows) {
        const v = Number(r.version);
        const known = s.versions.get(r.tag);
        if (known !== undefined && known !== v) changed.push(r.tag);
        s.versions.set(r.tag, v);
      }
      if (changed.length) forgetTags(changed);
    } catch (e) {
      warnOnce(e);
    } finally {
      s.checkedAt = Date.now();
      s.checking = null;
    }
  })();
  await s.checking;
}

/**
 * Il valore di `load()` in cache sotto `key`, svuotato quando cambiano i
 * dati di una delle `tags`. `key` deve contenere tutti i parametri.
 */
export async function cached<T>(key: string, tags: readonly CacheTag[], load: () => Promise<T>): Promise<T> {
  await syncVersions();
  return memo(key, CACHE_TTL_MS, load, Date.now(), tags);
}

/**
 * Come cached(), ma per tante voci dello stesso tipo (es. una riga per
 * album): quelle mancanti si caricano tutte insieme con una sola query.
 * Gli id che `loadMissing` non restituisce valgono undefined.
 */
export async function cachedMany<K, V>(
  ids: readonly K[],
  keyOf: (id: K) => string,
  tags: readonly CacheTag[],
  loadMissing: (ids: K[]) => Promise<Map<K, V>>,
): Promise<Map<K, V | undefined>> {
  await syncVersions();
  const now = Date.now();
  const missing = ids.filter((id) => !isFresh(keyOf(id), CACHE_TTL_MS, now));
  let batch: Promise<Map<K, V>> | null = null;
  const loadBatch = () => (batch ??= loadMissing(missing));
  // memo() salva la promessa in modo sincrono: nessuna attesa fra il
  // controllo qui sopra e il salvataggio delle voci.
  const values = ids.map((id) => memo(keyOf(id), CACHE_TTL_MS, async () => (await loadBatch()).get(id), now, tags));
  const out = new Map<K, V | undefined>();
  const resolved = await Promise.all(values);
  ids.forEach((id, i) => out.set(id, resolved[i]));
  return out;
}

/**
 * Chiamata da db.ts dopo una scrittura: svuota subito le voci di questo
 * processo e, poco dopo, avvisa gli altri processi.
 */
export function noteWrite(tags: readonly CacheTag[]): void {
  if (!tags.length) return;
  forgetTags(tags);
  const s = state();
  for (const t of tags) s.pending.add(t);
  if (!s.flushTimer) {
    s.flushTimer = setTimeout(() => void flushCacheVersions(), FLUSH_DELAY_MS);
    // Non tiene in vita un programma che ha finito: ci pensa closePool().
    s.flushTimer.unref?.();
  }
}

/** Aumenta la versione delle etichette scritte da questo processo. */
export async function flushCacheVersions(): Promise<void> {
  const s = state();
  if (s.flushTimer) clearTimeout(s.flushTimer);
  s.flushTimer = null;
  const tags = [...s.pending];
  s.pending.clear();
  for (const tag of tags) {
    try {
      // LAST_INSERT_ID(expr) restituisce la nuova versione: se è quella che
      // ci si aspetta, la scrittura è solo nostra e non serve svuotare di nuovo.
      const [res] = await pool().query<import("mysql2").ResultSetHeader>(
        `INSERT INTO cache_versions (tag, version, updated_at) VALUES (?, LAST_INSERT_ID(1), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE version = LAST_INSERT_ID(version + 1), updated_at = UTC_TIMESTAMP()`,
        [tag],
      );
      const known = s.versions.get(tag);
      if (known === undefined || res.insertId === known + 1) s.versions.set(tag, res.insertId);
    } catch (e) {
      warnOnce(e);
    }
  }
}

/** Svuota tutta la cache di questo processo (pulsante in Statistiche). */
export function clearCache(): number {
  return forgetAll();
}

export type CacheSummary = { tag: string; entries: number; oldestAgeMs: number | null };

/** Voci in cache per etichetta e da quanto c'è la più vecchia, per Statistiche. */
export function cacheSummary(now = Date.now()): CacheSummary[] {
  return memoSummary().map((s: MemoSummary) => ({
    tag: s.tag,
    entries: s.entries,
    oldestAgeMs: s.oldestAt === null ? null : now - s.oldestAt,
  }));
}
