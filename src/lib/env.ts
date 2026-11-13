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

  // SMTP (in produzione xCloud Mail Delivery). Se SMTP_HOST è vuoto le email
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
  // Giorni nel cestino prima dell'eliminazione definitiva automatica
  // (`npm run cestino`, lanciato da un cron).
  TRASH_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  // Archivio dei file (CR2 e anteprime).
  //   local -> cartella sul server, solo per prove e sviluppo
  //   gcs   -> Google Cloud Storage (produzione)
  STORAGE_DRIVER: z.enum(["local", "gcs"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage-locale"),
  // Segreto per firmare gli URL del driver "local" (almeno 32 caratteri).
  // Se manca se ne genera uno a ogni avvio: gli URL firmati scadono al riavvio.
  STORAGE_SIGNING_SECRET: z.string().min(32).optional(),
  GCS_BUCKET: z.string().optional(),
  // App ID del ricevitore Chromecast nostro (pagina /tv, registrata nella Cast
  // Developer Console). Vuoto = ricevitore standard di Google, senza transizioni.
  CAST_APP_ID: z
    .string()
    .regex(/^[0-9A-F]{8}$/i)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // File JSON dell'account di servizio; se vuoti sia questo sia GCS_KEY_JSON
  // si usano le credenziali predefinite di Google (GOOGLE_APPLICATION_CREDENTIALS).
  GCS_KEY_FILE: z.string().optional(),
  // In alternativa: il contenuto del file JSON, comodo da incollare nelle
  // variabili d'ambiente di xCloud.
  GCS_KEY_JSON: z.string().optional(),

  // Riconoscimento dei volti (`npm run volti`, gira sulla VPS).
  // Cartella dei modelli InsightFace, fuori dal repository.
  FACES_MODEL_DIR: z.string().default("./modelli-volti"),
  // Thread di calcolo: pochi, la VPS ospita anche altri siti.
  FACES_THREADS: z.coerce.number().int().min(1).max(8).default(2),
  // Lato del quadrato del rilevatore: più grande trova volti più piccoli ma è più lento.
  FACES_DET_SIZE: z.coerce.number().int().min(320).max(1600).multipleOf(32).default(640),
  // Lato minimo di un volto, in pixel dell'anteprima (2048 px): sotto si ignora.
  FACES_MIN_SIZE: z.coerce.number().int().min(16).default(40),

  // Nomi dei luoghi dalle coordinate GPS (`npm run luoghi`, gira sulla VPS):
  // cartella con l'elenco delle località di GeoNames, fuori dal repository.
  PLACES_DATA_DIR: z.string().default("./dati-luoghi"),

  // Import da Google Drive (`npm run drive`, gira sulla VPS). Client OAuth
  // "Applicazione web" del progetto Google Cloud, con URI di reindirizzamento
  // <APP_URL>/api/google-drive/callback. Senza queste variabili la pagina
  // Import → Google Drive spiega come configurarle.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Segreto per cifrare il refresh token di Drive nel database (almeno 32 caratteri).
  GOOGLE_TOKEN_SECRET: z.string().min(32).optional(),
  // Segreto per cifrare i link liberi nel database, così il proprietario li
  // rivede (almeno 32 caratteri). Se manca si usa GOOGLE_TOKEN_SECRET; senza
  // nessuno dei due il link si vede solo quando viene creato.
  SHARE_LINK_SECRET: z.string().min(32).optional(),
  // Cartella di lavoro sulla VPS: ci finisce un lotto di file alla volta.
  DRIVE_WORK_DIR: z.string().default("./lavoro-drive"),
  // Dimensione massima di un lotto (GB): tanto spazio libero serve sul disco, più 2 GB.
  DRIVE_BATCH_GB: z.coerce.number().positive().max(50).default(4),
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
