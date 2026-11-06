"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { execute, queryOne } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { createSession, destroyAllSessions, destroySession, requireUser } from "@/lib/session";
import { consumeToken, issueToken } from "@/lib/auth-tokens";
import { sendPasswordResetEmail } from "@/lib/mail";
import { hit, clear } from "@/lib/rate-limit";
import { emailSchema, firstError, newPasswordForm, type FormState } from "@/lib/validation";

async function clientMeta() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent") };
}

// Hash fittizio: se l'email non esiste facciamo comunque il calcolo,
// così i tempi di risposta non rivelano quali email sono registrate.
let dummyHash: Promise<string> | undefined;

const loginForm = z.object({ email: emailSchema, password: z.string().min(1, { error: "Inserisci la password." }) });

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginForm.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const { email, password } = parsed.data;

  const meta = await clientMeta();
  const limitKey = `login:${meta.ip}:${email}`;
  if (!hit(limitKey, 10, 15 * 60_000)) {
    return { error: "Troppi tentativi. Riprova tra qualche minuto." };
  }

  const user = await queryOne<{ id: number; password_hash: string | null; disabled_at: Date | null }>(
    "SELECT id, password_hash, disabled_at FROM users WHERE email = ?",
    [email],
  );
  dummyHash ??= hashPassword("password-fittizia");
  const ok = await verifyPassword(password, user?.password_hash ?? (await dummyHash));
  if (!user || !user.password_hash || !ok || user.disabled_at) {
    return { error: "Email o password non corretti." };
  }

  clear(limitKey);
  await createSession(user.id, meta);
  const next = String(formData.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function requestPasswordReset(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: firstError(parsed.error) };
  const email = parsed.data;

  const meta = await clientMeta();
  if (!hit(`reset:${meta.ip}`, 5, 15 * 60_000)) {
    return { error: "Troppe richieste. Riprova tra qualche minuto." };
  }

  // Risposta identica che l'utente esista o no.
  const done: FormState = { ok: "Se l'email è registrata, riceverai a breve un link per reimpostare la password." };
  const user = await queryOne<{ id: number; name: string; password_hash: string | null }>(
    "SELECT id, name, password_hash FROM users WHERE email = ? AND disabled_at IS NULL",
    [email],
  );
  // Chi non ha ancora accettato l'invito deve usare il link di invito.
  if (!user || !user.password_hash) return done;

  const token = await issueToken(user.id, "password_reset");
  await sendPasswordResetEmail(email, user.name, token);
  return done;
}

/** Imposta la password da un token (reset o invito) e apre la sessione. */
async function setPasswordWithToken(
  purpose: "password_reset" | "invite",
  token: string,
  formData: FormData,
): Promise<FormState> {
  const parsed = newPasswordForm.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { error: firstError(parsed.error) };

  const hash = await hashPassword(parsed.data.password);
  const userId = await consumeToken(token, purpose, async (id, q) => {
    await q(
      `UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP())
        WHERE id = ?`,
      [hash, id],
    );
    return id;
  });
  if (userId === null) return { error: "Il link non è valido o è scaduto. Chiedine uno nuovo." };

  await destroyAllSessions(userId);
  await createSession(userId, await clientMeta());
  redirect("/dashboard");
}

export async function resetPassword(token: string, _: FormState, formData: FormData): Promise<FormState> {
  return setPasswordWithToken("password_reset", token, formData);
}

export async function acceptInvite(token: string, _: FormState, formData: FormData): Promise<FormState> {
  return setPasswordWithToken("invite", token, formData);
}

/** Usato dalla pagina "Il mio account". */
export async function changeOwnPassword(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const parsed = newPasswordForm.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { error: firstError(parsed.error) };

  const row = await queryOne<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE id = ?", [user.id]);
  if (!row?.password_hash || !(await verifyPassword(current, row.password_hash))) {
    return { error: "La password attuale non è corretta." };
  }
  await execute("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(parsed.data.password), user.id]);
  await destroyAllSessions(user.id);
  await createSession(user.id, await clientMeta());
  return { ok: "Password aggiornata. Le altre sessioni sono state chiuse." };
}
