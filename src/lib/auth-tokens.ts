import "server-only";
import { pool, queryOne } from "./db";
import { newToken, sha256 } from "./crypto";
import type { RowDataPacket } from "mysql2/promise";

/*
 * Token monouso (tabella `auth_tokens`) per invito e reset password.
 * Nel database c'è solo l'hash; il token in chiaro esiste solo nel link email.
 */
export type TokenPurpose = "invite" | "password_reset" | "email_verify";

export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  invite: 7 * 86_400_000, // 7 giorni per accettare un invito
  password_reset: 60 * 60_000, // 1 ora per il reset
  email_verify: 2 * 86_400_000,
};

/** Crea un nuovo token e invalida quelli precedenti dello stesso tipo. */
export async function issueToken(userId: number, purpose: TokenPurpose): Promise<string> {
  const token = newToken();
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "UPDATE auth_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND purpose = ? AND used_at IS NULL",
      [userId, purpose],
    );
    await conn.query(
      "INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?)",
      [userId, purpose, sha256(token), new Date(Date.now() + TOKEN_TTL_MS[purpose])],
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return token;
}

type TokenRow = { id: number; user_id: number; email: string; name: string };

/** Controlla un token senza consumarlo (per mostrare la pagina giusta). */
export async function peekToken(token: string, purpose: TokenPurpose): Promise<TokenRow | null> {
  return queryOne<TokenRow>(
    `SELECT t.id, t.user_id, u.email, u.name
       FROM auth_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.purpose = ?
        AND t.used_at IS NULL AND t.expires_at > UTC_TIMESTAMP()
        AND u.disabled_at IS NULL`,
    [sha256(token), purpose],
  );
}

/**
 * Consuma il token e, nella stessa transazione, esegue `then` con l'id utente.
 * Restituisce null se il token non è valido o è già stato usato.
 */
export async function consumeToken<T>(
  token: string,
  purpose: TokenPurpose,
  then: (userId: number, q: (sql: string, params: unknown[]) => Promise<unknown>) => Promise<T>,
): Promise<T | null> {
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT t.id, t.user_id FROM auth_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ? AND t.purpose = ?
          AND t.used_at IS NULL AND t.expires_at > UTC_TIMESTAMP()
          AND u.disabled_at IS NULL
        FOR UPDATE`,
      [sha256(token), purpose],
    );
    const row = rows[0] as { id: number; user_id: number } | undefined;
    if (!row) {
      await conn.rollback();
      return null;
    }
    await conn.query("UPDATE auth_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ?", [row.id]);
    const result = await then(row.user_id, (sql, params) => conn.query(sql, params));
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
