import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { execute, queryOne } from "./db";
import { env } from "./env";

/*
 * Google Drive del proprietario, in sola lettura: collegamento OAuth,
 * token cifrato nel database e chiamate all'API REST di Drive v3.
 * Usato dalla pagina Import → Google Drive e da `npm run drive` (VPS).
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const DRIVE_CALLBACK_PATH = "/api/google-drive/callback";
export const DRIVE_STATE_COOKIE = "pa_drive_state";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";

export function driveConfigured(): boolean {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.GOOGLE_TOKEN_SECRET);
}

export function driveRedirectUri(): string {
  return new URL(DRIVE_CALLBACK_PATH, env().APP_URL).toString();
}

/** Indirizzo della pagina di consenso di Google. */
export function driveAuthUrl(state: string): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: env().GOOGLE_CLIENT_ID!,
    redirect_uri: driveRedirectUri(),
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent", // così Google restituisce sempre il refresh token
    state,
  }).toString();
  return u.toString();
}

// ---------------------------------------------------------------------
// Cifratura del refresh token (AES-256-GCM)
// ---------------------------------------------------------------------

function tokenKey(): Buffer {
  const secret = env().GOOGLE_TOKEN_SECRET;
  if (!secret) throw new Error("Manca GOOGLE_TOKEN_SECRET.");
  return createHash("sha256").update(`pa-drive-token:${secret}`).digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decryptToken(stored: string): string {
  const [v, iv, tag, data] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Token di Drive in un formato sconosciuto.");
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

// ---------------------------------------------------------------------
// Account collegato
// ---------------------------------------------------------------------

export type DriveAccount = { id: number; user_id: number; email: string | null; created_at: Date };

/** L'account Drive collegato (ce n'è al massimo uno, del proprietario). */
export async function driveAccount(): Promise<DriveAccount | null> {
  return queryOne<DriveAccount>(
    `SELECT a.id, a.user_id, a.email, a.created_at
       FROM google_drive_accounts a JOIN users u ON u.id = a.user_id
      WHERE u.role = 'owner' AND u.disabled_at IS NULL
      ORDER BY a.id LIMIT 1`,
  );
}

class OAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

async function tokenRequest(params: Record<string, string>) {
  const e = env();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: e.GOOGLE_CLIENT_ID!, client_secret: e.GOOGLE_CLIENT_SECRET!, ...params }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new OAuthError(data.error_description ?? data.error ?? `HTTP ${res.status}`, data.error ?? "http");
  }
  return data;
}

/** Scambia il codice del consenso, salva il token e restituisce l'email dell'account Google. */
export async function connectDrive(userId: number, code: string): Promise<string | null> {
  const tokens = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: driveRedirectUri() });
  if (!tokens.refresh_token) throw new Error("Google non ha restituito un token permanente: riprova.");
  const client = new DriveClient(tokens.refresh_token, { token: tokens.access_token!, expiresAt: Date.now() + 3000_000 });
  const about = await client.get<{ user?: { emailAddress?: string } }>("about", { fields: "user(emailAddress)" });
  const email = about.user?.emailAddress?.slice(0, 320) ?? null;
  await execute(
    `INSERT INTO google_drive_accounts (user_id, email, refresh_token_enc) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE email = VALUES(email), refresh_token_enc = VALUES(refresh_token_enc),
                             created_at = UTC_TIMESTAMP(), last_used_at = NULL`,
    [userId, email, encryptToken(tokens.refresh_token)],
  );
  return email;
}

/** Revoca il token presso Google (se possibile) e dimentica l'account. */
export async function disconnectDrive(userId: number): Promise<void> {
  const row = await queryOne<{ refresh_token_enc: string }>(
    "SELECT refresh_token_enc FROM google_drive_accounts WHERE user_id = ?",
    [userId],
  );
  if (!row) return;
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: decryptToken(row.refresh_token_enc) }),
    });
  } catch {
    // Google irraggiungibile: si cancella comunque. Antonio può revocare
    // l'accesso anche da myaccount.google.com → Sicurezza.
  }
  await execute("DELETE FROM google_drive_accounts WHERE user_id = ?", [userId]);
}

// ---------------------------------------------------------------------
// Client dell'API di Drive
// ---------------------------------------------------------------------

export class DriveAuthError extends Error {}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FILE_FIELDS = "id, name, mimeType, size, modifiedTime, parents";

export class DriveClient {
  private access: { token: string; expiresAt: number } | null;

  constructor(
    private readonly refreshToken: string,
    access?: { token: string; expiresAt: number },
  ) {
    this.access = access ?? null;
  }

  /** Client dell'account collegato, o null se Drive non è collegato. */
  static async forOwner(): Promise<DriveClient | null> {
    const row = await queryOne<{ id: number; refresh_token_enc: string }>(
      `SELECT a.id, a.refresh_token_enc FROM google_drive_accounts a JOIN users u ON u.id = a.user_id
        WHERE u.role = 'owner' AND u.disabled_at IS NULL ORDER BY a.id LIMIT 1`,
    );
    if (!row) return null;
    await execute("UPDATE google_drive_accounts SET last_used_at = UTC_TIMESTAMP() WHERE id = ?", [row.id]);
    return new DriveClient(decryptToken(row.refresh_token_enc));
  }

  async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt > Date.now() + 60_000) return this.access.token;
    try {
      const t = await tokenRequest({ refresh_token: this.refreshToken, grant_type: "refresh_token" });
      this.access = { token: t.access_token!, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 };
      return this.access.token;
    } catch (e) {
      if (e instanceof OAuthError && e.code === "invalid_grant") {
        throw new DriveAuthError(
          "Il collegamento a Google Drive è scaduto o è stato revocato: ricollegalo dalla pagina Import → Google Drive.",
        );
      }
      throw e;
    }
  }

  /** Richiesta all'API (risposta grezza), ritentata su errori di rete, 429 e 5xx. */
  async request(url: string, init: { headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<Response> {
    let last: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) await sleep(Math.min(30_000, 1000 * 2 ** attempt));
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${await this.accessToken()}`, ...init.headers },
          signal: init.signal,
        });
      } catch (e) {
        if (e instanceof DriveAuthError || init.signal?.aborted) throw e;
        last = e;
        continue;
      }
      if (res.ok) return res;
      const text = (await res.text().catch(() => "")).slice(0, 500);
      if (res.status === 401) {
        this.access = null;
        last = new Error(`Drive: accesso negato (${text})`);
        continue;
      }
      // 403 per limiti di frequenza ("rateLimitExceeded") si ritenta, gli altri no.
      const retry = res.status === 429 || res.status >= 500 || (res.status === 403 && /rate ?limit/i.test(text));
      const err = new Error(`Drive: HTTP ${res.status} ${text}`);
      if (!retry) throw err;
      last = err;
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const u = new URL(`${API}/${path}`);
    u.search = new URLSearchParams(params).toString();
    return (await (await this.request(u.toString())).json()) as T;
  }

  async file(id: string): Promise<DriveFile> {
    return this.get<DriveFile>(`files/${encodeURIComponent(id)}`, { fields: FILE_FIELDS, supportsAllDrives: "true" });
  }

  /** Tutti i file che rispondono alla ricerca `q` (sintassi di Drive), pagina dopo pagina. */
  async list(q: string, opts: { orderBy?: string; max?: number } = {}): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.get<{ files: DriveFile[]; nextPageToken?: string }>("files", {
        q,
        fields: `nextPageToken, files(${FILE_FIELDS})`,
        pageSize: "1000",
        orderBy: opts.orderBy ?? "folder, name_natural",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        ...(pageToken ? { pageToken } : {}),
      });
      out.push(...page.files);
      pageToken = page.nextPageToken;
    } while (pageToken && out.length < (opts.max ?? Infinity));
    return out;
  }

  /** Contenuto di un file; con `range` solo i byte [start, end). */
  async download(id: string, range?: { start: number; end: number }, signal?: AbortSignal): Promise<Response> {
    const url = `${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
    const headers: Record<string, string> = range ? { Range: `bytes=${range.start}-${range.end - 1}` } : {};
    return this.request(url, { headers, signal });
  }
}

/** Per le ricerche di Drive: una stringa tra apici. */
export function driveQuote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
