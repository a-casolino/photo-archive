import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { execute, queryOne } from "./db";
import { env } from "./env";
import { newToken, sha256 } from "./crypto";
import type { Role } from "./roles";

/*
 * Sessioni lato server (tabella `sessions`): nel cookie c'è un token casuale,
 * nel database solo il suo SHA-256. Revocabili in ogni momento.
 */
export const SESSION_COOKIE = "pa_session";

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  role: Role;
};

export async function createSession(userId: number, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = newToken();
  const ttlDays = env().SESSION_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  await execute(
    "INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)",
    [sha256(token), userId, expiresAt, meta.ip ?? null, meta.userAgent?.slice(0, 255) ?? null],
  );
  await execute("UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?", [userId]);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Utente collegato, oppure null. Memorizzato per la durata della richiesta. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return queryOne<SessionUser>(
    `SELECT u.id, u.email, u.name, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
        AND s.expires_at > UTC_TIMESTAMP()
        AND u.disabled_at IS NULL`,
    [sha256(token)],
  );
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireOwner(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/dashboard");
  return user;
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await execute("DELETE FROM sessions WHERE id = ?", [sha256(token)]);
  store.delete(SESSION_COOKIE);
}

/** Chiude tutte le sessioni di un utente (cambio password, disattivazione). */
export async function destroyAllSessions(userId: number) {
  await execute("DELETE FROM sessions WHERE user_id = ?", [userId]);
}
