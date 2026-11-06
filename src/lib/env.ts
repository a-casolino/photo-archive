import { z } from "zod";

/**
 * Configurazione letta dalle variabili d'ambiente (vedi .env.example).
 * Validata al primo uso, così un errore di configurazione emerge subito
 * con un messaggio chiaro.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),

  DATABASE_HOST: z.string().default("127.0.0.1"),
  DATABASE_PORT: z.coerce.number().int().default(3306),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string().default(""),
  DATABASE_NAME: z.string().min(1),

  // SMTP: provider non ancora scelto. Se SMTP_HOST è vuoto le email
  // vengono scritte nel log del server invece di essere inviate.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default("Archivio foto <noreply@localhost>"),

  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SHARE_LINK_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error("Configurazione non valida:\n" + z.prettifyError(parsed.error));
    }
    cached = parsed.data;
  }
  return cached;
}
