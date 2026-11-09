import "server-only";
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
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

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool().query<RowDataPacket[]>(sql, params);
  return rows as T[];
}

export async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [res] = await pool().query<ResultSetHeader>(sql, params);
  return res;
}
