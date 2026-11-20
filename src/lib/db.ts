import "server-only";
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { flushCacheVersions, noteWrite, type CacheTag } from "./cache";
import { tagsForSql } from "./cache-rules";
import { env } from "./env";

// Un solo pool per processo (anche con l'hot reload di `next dev`).
const g = globalThis as unknown as { __photoArchivePool?: Pool };

export function pool(): Pool {
  if (!g.__photoArchivePool) {
    const e = env();
    g.__photoArchivePool = mysql.createPool({
      host: e.DATABASE_HOST,
      port: e.DATABASE_PORT,
      user: e.DATABASE_USER,
      password: e.DATABASE_PASSWORD,
      database: e.DATABASE_NAME,
      connectionLimit: 10,
      timezone: "Z", // tutte le date in UTC, come da schema
      charset: "utf8mb4",
    });
    // Anche per MySQL la sessione è in UTC: così i DEFAULT CURRENT_TIMESTAMP
    // (created_at, ...) sono in UTC come il resto, non nell'ora del server.
    g.__photoArchivePool.on("connection", (conn) => {
      conn.query("SET time_zone = '+00:00'");
    });
  }
  return g.__photoArchivePool;
}

/**
 * Per i programmi da riga di comando: avvisa l'app delle scritture fatte
 * (versioni della cache) e chiude le connessioni.
 */
export async function closePool(): Promise<void> {
  await flushCacheVersions();
  await g.__photoArchivePool?.end();
  g.__photoArchivePool = undefined;
}

/** Una query più lenta di così finisce nel log, con le prime righe dell'SQL. */
const SLOW_QUERY_MS = 300;

async function timed<R>(sql: string, run: () => Promise<R>): Promise<R> {
  const t0 = performance.now();
  try {
    return await run();
  } finally {
    const ms = performance.now() - t0;
    if (ms >= SLOW_QUERY_MS) {
      console.warn(`[db] query lenta ${Math.round(ms)} ms: ${sql.replace(/\s+/g, " ").trim().slice(0, 300)}`);
    }
  }
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await timed(sql, () => pool().query<RowDataPacket[]>(sql, params));
  return rows as T[];
}

export async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * INSERT/UPDATE/DELETE: dopo la scrittura svuota le voci della cache che
 * dipendono da quella tabella (vedi cache-rules.ts).
 */
export async function execute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [res] = await timed(sql, () => pool().query<ResultSetHeader>(sql, params));
  noteWrite(tagsForSql(sql));
  return res;
}

/**
 * Connessione per le transazioni. Le scritture fatte con conn.query()
 * svuotano la cache quando la connessione viene rilasciata (dopo il commit
 * o il rollback), non prima: altrimenti una pagina potrebbe rileggere i
 * dati vecchi e rimetterli in cache prima del commit.
 */
export async function getConnection(): Promise<PoolConnection> {
  const conn = await pool().getConnection();
  const touched = new Set<CacheTag>();
  const original = conn.query.bind(conn) as (...args: unknown[]) => Promise<unknown>;
  (conn as unknown as { query: (...args: unknown[]) => Promise<unknown> }).query = (...args: unknown[]) => {
    const sql = typeof args[0] === "string" ? args[0] : ((args[0] as { sql?: string })?.sql ?? "");
    for (const t of tagsForSql(sql)) touched.add(t);
    return timed(sql, () => original(...args));
  };
  const release = conn.release.bind(conn);
  conn.release = () => {
    (conn as unknown as { query: unknown }).query = original;
    conn.release = release;
    release();
    noteWrite([...touched]);
  };
  return conn;
}
