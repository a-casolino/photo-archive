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

  // Archivio dei file (CR2 e anteprime).
  //   local -> cartella sul server, solo per prove e sviluppo
  //   gcs   -> Google Cloud Storage (produzione)
  STORAGE_DRIVER: z.enum(["local", "gcs"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage-locale"),
  // Segreto per firmare gli URL del driver "local" (almeno 32 caratteri).
  // Se manca se ne genera uno a ogni avvio: gli URL firmati scadono al riavvio.
  STORAGE_SIGNING_SECRET: z.string().min(32).optional(),
  GCS_BUCKET: z.string().optional(),
  // File JSON dell'account di servizio; se vuoto si usano le credenziali
  // predefinite di Google (GOOGLE_APPLICATION_CREDENTIALS).
  GCS_KEY_FILE: z.string().optional(),
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
