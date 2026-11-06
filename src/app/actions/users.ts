"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { execute, queryOne } from "@/lib/db";
import { requireOwner, destroyAllSessions } from "@/lib/session";
import { issueToken } from "@/lib/auth-tokens";
import { sendInviteEmail } from "@/lib/mail";
import { emailSchema, firstError, type FormState } from "@/lib/validation";

// Il proprietario è uno solo (Antonio): dall'interfaccia si invitano
// solo fidati e visualizzatori.
const invitableRole = z.enum(["trusted", "viewer"], { error: "Ruolo non valido." });

const inviteForm = z.object({
  name: z.string().trim().min(1, { error: "Inserisci il nome." }).max(120),
  email: emailSchema,
  role: invitableRole,
});

export async function inviteUser(_: FormState, formData: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = inviteForm.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const { name, email, role } = parsed.data;

  const existing = await queryOne<{ id: number; password_hash: string | null }>(
    "SELECT id, password_hash FROM users WHERE email = ?",
    [email],
  );
  if (existing?.password_hash) return { error: "Esiste già un utente attivo con questa email." };

  let userId: number;
  if (existing) {
    await execute("UPDATE users SET name = ?, role = ?, disabled_at = NULL WHERE id = ?", [name, role, existing.id]);
    userId = existing.id;
  } else {
    const res = await execute("INSERT INTO users (email, name, role) VALUES (?, ?, ?)", [email, name, role]);
    userId = res.insertId;
  }

  const token = await issueToken(userId, "invite");
  await sendInviteEmail(email, name, token);
  revalidatePath("/admin/utenti");
  return { ok: `Invito inviato a ${email}.` };
}

const userIdSchema = z.coerce.number().int().positive();

/** Carica l'utente bersaglio, escludendo il proprietario (non modificabile da qui). */
async function targetUser(raw: FormDataEntryValue | null) {
  const id = userIdSchema.parse(raw);
  const user = await queryOne<{ id: number; email: string; name: string; role: string; password_hash: string | null }>(
    "SELECT id, email, name, role, password_hash FROM users WHERE id = ? AND role <> 'owner'",
    [id],
  );
  if (!user) throw new Error("Utente non trovato.");
  return user;
}

export async function changeRole(formData: FormData): Promise<void> {
  await requireOwner();
  const user = await targetUser(formData.get("userId"));
  const role = invitableRole.parse(formData.get("role"));
  await execute("UPDATE users SET role = ? WHERE id = ?", [role, user.id]);
  revalidatePath("/admin/utenti");
}

export async function setDisabled(formData: FormData): Promise<void> {
  await requireOwner();
  const user = await targetUser(formData.get("userId"));
  const disable = formData.get("disable") === "1";
  await execute("UPDATE users SET disabled_at = ? WHERE id = ?", [disable ? new Date() : null, user.id]);
  if (disable) await destroyAllSessions(user.id);
  revalidatePath("/admin/utenti");
}

export async function resendInvite(formData: FormData): Promise<void> {
  await requireOwner();
  const user = await targetUser(formData.get("userId"));
  if (user.password_hash) return; // ha già scelto la password
  const token = await issueToken(user.id, "invite");
  await sendInviteEmail(user.email, user.name, token);
  revalidatePath("/admin/utenti");
}
