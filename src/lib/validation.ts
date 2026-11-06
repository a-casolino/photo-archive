import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Email non valida." }));

export const passwordSchema = z
  .string()
  .min(10, { error: "La password deve avere almeno 10 caratteri." })
  .max(200, { error: "La password è troppo lunga." });

export const newPasswordForm = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { error: "Le due password non coincidono.", path: ["confirm"] });

export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dati non validi.";
}

/** Stato restituito dalle Server Action dei form. */
export type FormState = { error?: string; ok?: string } | undefined;
