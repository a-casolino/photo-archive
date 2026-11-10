import "server-only";
import { execute, pool, query, queryOne } from "./db";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { randomBase62, sha256 } from "./crypto";
import { env } from "./env";
import { isPhotoInBranch } from "./gallery";
import { appUrl, sendMail } from "./mail";
import { getNamedLinkShare, recordNamedLinkView } from "./named-links";
import { linkKeyKind } from "./named-link-rules";
import type { DownloadLevel } from "./roles";
import type { SessionUser } from "./session";
import type { ResultSetHeader } from "mysql2/promise";

/*
 * Condivisioni di una foto o di un album:
 *   'users' -> protetta: solo gli utenti in share_recipients, dopo il login
 *              (/condivisi/<public_id>);
 *   'link'  -> libera: chiunque abbia l'URL /l/<token>. Il link si apre
 *              cercando lo SHA-256 del token (`token`); in `token_enc` c'è
 *              anche una copia cifrata, solo per rimostrarlo al proprietario.
 * Anche i link con nome (/l/<nome>, src/lib/named-links.ts) si aprono come
 * link liberi: getLinkShare() riconosce i due casi dalla forma.
 * Il permesso di download effettivo si calcola sempre con effectiveDownload().
 */

export type ShareRow = {
  id: number;
  public_id: string;
  target_type: "photo" | "album";
  photo_id: number | null;
  album_id: number | null;
  mode: "users" | "link";
  message: string | null;
  allow_download: DownloadLevel;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  view_count: number;
  last_viewed_at: Date | null;
  /** Presente solo per i link con nome (/l/<nome>, tabella named_links). */
  named_link_id?: number;
};

const SHARE_COLUMNS = `s.id, s.public_id, s.target_type, s.photo_id, s.album_id, s.mode, s.message,
  s.allow_download, s.expires_at, s.revoked_at, s.created_at, s.view_count, s.last_viewed_at`;

const ACTIVE =
  "s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > UTC_TIMESTAMP())";

/** Token dei link liberi: 32 caratteri base62 (~190 bit). */
const TOKEN_RE = /^[0-9A-Za-z]{32}$/;
const PUBLIC_ID_RE = /^[0-9A-Za-z]{22}$/;

/**
 * Condivisione protetta valida per questo utente. Il proprietario può
 * aprire qualsiasi condivisione (per vedere cosa vedono gli altri).
 */
export async function getUserShare(
  publicId: string,
  user: SessionUser,
): Promise<ShareRow | null> {
  if (!PUBLIC_ID_RE.test(publicId)) return null;
  if (user.role === "owner") {
    return queryOne<ShareRow>(
      `SELECT ${SHARE_COLUMNS} FROM shares s WHERE s.public_id = ? AND s.mode = 'users'`,
      [publicId],
    );
  }
  return queryOne<ShareRow>(
    `SELECT ${SHARE_COLUMNS} FROM shares s
       JOIN share_recipients sr ON sr.share_id = s.id AND sr.user_id = ?
      WHERE s.public_id = ? AND s.mode = 'users' AND ${ACTIVE}`,
    [user.id, publicId],
  );
}

/** Link libero valido, dal token dell'URL o dal nome di un link con nome. */
export async function getLinkShare(token: string): Promise<ShareRow | null> {
  const kind = linkKeyKind(token);
  if (kind === "slug") return getNamedLinkShare(token);
  if (kind !== "token") return null;
  return queryOne<ShareRow>(
    `SELECT ${SHARE_COLUMNS} FROM shares s WHERE s.token = ? AND s.mode = 'link' AND ${ACTIVE}`,
    [sha256(token)],
  );
}

/**
 * La foto fa parte della condivisione? Per un album: anche le foto aggiunte
 * dopo e quelle dei sotto-album (anche creati dopo).
 */
export async function shareCoversPhoto(
  share: ShareRow,
  photoId: number,
): Promise<boolean> {
  if (share.target_type === "photo") return share.photo_id === photoId;
  return share.album_id !== null && isPhotoInBranch(share.album_id, photoId);
}

export type ShareEvent = "view" | "download_preview" | "download_original";

/** Registra una vista o un download (non per il proprietario). */
export async function recordShareEvent(
  share: ShareRow,
  event: ShareEvent,
  who: { userId: number | null; photoId?: number | null; ip?: string | null },
) {
  // Link con nome: solo il conteggio delle visite, nella sua tabella.
  if (share.named_link_id !== undefined) {
    if (event === "view") await recordNamedLinkView(share.named_link_id);
    return;
  }
  await execute(
    "INSERT INTO share_events (share_id, user_id, photo_id, event, ip) VALUES (?, ?, ?, ?, ?)",
    [
      share.id,
      who.userId,
      who.photoId ?? null,
      event,
      who.ip?.slice(0, 45) ?? null,
    ],
  );
  if (event === "view") {
    await execute(
      "UPDATE shares SET view_count = view_count + 1, last_viewed_at = UTC_TIMESTAMP() WHERE id = ?",
      [share.id],
    );
    if (who.userId) {
      await execute(
        `UPDATE share_recipients SET first_viewed_at = UTC_TIMESTAMP()
          WHERE share_id = ? AND user_id = ? AND first_viewed_at IS NULL`,
        [share.id, who.userId],
      );
    }
  }
}

// ---------------------------------------------------------------------
// Creazione e gestione (solo proprietario: i chiamanti fanno requireOwner)
// ---------------------------------------------------------------------

export type NewShare = {
  target:
    | { type: "photo"; photoId: number }
    | { type: "album"; albumId: number };
  title: string;
  mode: "users" | "link";
  allowDownload: DownloadLevel;
  message: string | null;
  recipientIds: number[];
  linkDays: number;
  createdBy: SessionUser;
};

export function newLinkToken(): string {
  return randomBase62(32);
}

export function linkUrl(token: string): string {
  return appUrl(`/l/${token}`);
}

// Copia cifrata del token (AES-256-GCM), per rimostrare il link al proprietario.
function linkKey(): Buffer | null {
  const secret = env().SHARE_LINK_SECRET ?? env().GOOGLE_TOKEN_SECRET;
  return secret
    ? createHash("sha256").update(`pa-share-link:${secret}`).digest()
    : null;
}

/** Token cifrato da salvare in `shares.token_enc`; null se manca la chiave. */
export function encryptLinkToken(token: string): string | null {
  const key = linkKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    data.toString("base64"),
  ].join(".");
}

/** Link completo da `shares.token_enc`; null se assente o illeggibile (chiave cambiata). */
export function storedLinkUrl(stored: string | null): string | null {
  const key = linkKey();
  if (!stored || !key) return null;
  try {
    const [v, iv, tag, data] = stored.split(".");
    if (v !== "v1" || !iv || !tag || !data) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const token = Buffer.concat([
      decipher.update(Buffer.from(data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return TOKEN_RE.test(token) ? linkUrl(token) : null;
  } catch {
    return null;
  }
}

/** Crea la condivisione; per i link restituisce anche il token in chiaro. */
export async function createShare(
  s: NewShare,
): Promise<{ publicId: string; token: string | null }> {
  const publicId = randomBase62(22);
  const token = s.mode === "link" ? newLinkToken() : null;
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO shares (public_id, target_type, photo_id, album_id, mode, token, token_enc, message,
                           allow_download, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId,
        s.target.type,
        s.target.type === "photo" ? s.target.photoId : null,
        s.target.type === "album" ? s.target.albumId : null,
        s.mode,
        token ? sha256(token) : null,
        token ? encryptLinkToken(token) : null,
        s.message,
        // I link liberi non danno mai l'originale (c'è anche il CHECK nel DB).
        s.mode === "link" && s.allowDownload === "original"
          ? "preview"
          : s.allowDownload,
        s.mode === "link"
          ? new Date(Date.now() + s.linkDays * 86_400_000)
          : null,
        s.createdBy.id,
      ],
    );
    if (s.mode === "users" && s.recipientIds.length) {
      await conn.query(
        `INSERT INTO share_recipients (share_id, user_id)
         SELECT ?, id FROM users WHERE id IN (?) AND role <> 'owner' AND disabled_at IS NULL`,
        [res.insertId, s.recipientIds],
      );
    }
    await conn.commit();
    if (s.mode === "users")
      await notifyRecipients(
        res.insertId,
        publicId,
        s.title,
        s.message,
        s.createdBy.name,
      );
    return { publicId, token };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Email "Antonio ha condiviso con te..." ai destinatari non ancora avvisati. */
async function notifyRecipients(
  shareId: number,
  publicId: string,
  title: string,
  message: string | null,
  from: string,
) {
  const recipients = await query<{
    id: number;
    email: string;
    name: string;
    activated: 0 | 1;
  }>(
    `SELECT u.id, u.email, u.name, u.password_hash IS NOT NULL AS activated
       FROM share_recipients sr JOIN users u ON u.id = sr.user_id
      WHERE sr.share_id = ? AND sr.notified_at IS NULL`,
    [shareId],
  );
  for (const r of recipients) {
    try {
      await sendMail({
        to: r.email,
        subject: `${from} ha condiviso con te: ${title}`,
        text:
          `Ciao ${r.name},\n\n` +
          `${from} ha condiviso con te "${title}" nell'archivio foto.\n` +
          (message ? `\n${message}\n` : "") +
          `\nLo trovi qui:\n${appUrl(`/condivisi/${publicId}`)}\n` +
          (r.activated
            ? ""
            : "\nPer entrare usa prima il link dell'invito che hai ricevuto.\n"),
      });
      await execute(
        "UPDATE share_recipients SET notified_at = UTC_TIMESTAMP() WHERE share_id = ? AND user_id = ?",
        [shareId, r.id],
      );
    } catch (e) {
      console.error("[shares] email non inviata a", r.email, e);
    }
  }
}

export async function addRecipients(
  shareId: number,
  publicId: string,
  userIds: number[],
  title: string,
  from: string,
) {
  if (!userIds.length) return;
  await execute(
    `INSERT IGNORE INTO share_recipients (share_id, user_id)
     SELECT ?, id FROM users WHERE id IN (?) AND role <> 'owner' AND disabled_at IS NULL`,
    [shareId, userIds],
  );
  const share = await queryOne<{ message: string | null }>(
    "SELECT message FROM shares WHERE id = ?",
    [shareId],
  );
  await notifyRecipients(
    shareId,
    publicId,
    title,
    share?.message ?? null,
    from,
  );
}

export function defaultLinkDays(): number {
  return env().SHARE_LINK_TTL_DAYS;
}

// ---------------------------------------------------------------------
// Elenchi per il proprietario
// ---------------------------------------------------------------------

export type ShareListItem = ShareRow & {
  target_title: string | null;
  target_public_id: string | null;
  recipients: string | null; // nomi separati da ", "
  /** Link libero completo, se se ne ha la copia cifrata. */
  link: string | null;
};

export async function listShares(
  filter: { photoId?: number; albumId?: number } = {},
): Promise<ShareListItem[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.photoId) {
    where.push("s.photo_id = ?");
    params.push(filter.photoId);
  }
  if (filter.albumId) {
    where.push("s.album_id = ?");
    params.push(filter.albumId);
  }
  const rows = await query<
    Omit<ShareListItem, "link"> & { token_enc: string | null }
  >(
    `SELECT ${SHARE_COLUMNS}, s.token_enc,
            COALESCE(a.title, p.title, p.original_filename) AS target_title,
            COALESCE(a.public_id, p.public_id) AS target_public_id,
            (SELECT GROUP_CONCAT(u.name ORDER BY u.name SEPARATOR ', ')
               FROM share_recipients sr JOIN users u ON u.id = sr.user_id WHERE sr.share_id = s.id) AS recipients
       FROM shares s
       LEFT JOIN albums a ON a.id = s.album_id
       LEFT JOIN photos p ON p.id = s.photo_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY s.revoked_at IS NOT NULL, s.created_at DESC
      LIMIT 500`,
    params,
  );
  return rows.map(({ token_enc, ...r }) => ({
    ...r,
    link: r.mode === "link" && !r.revoked_at ? storedLinkUrl(token_enc) : null,
  }));
}

/** Utenti a cui si può condividere (non il proprietario, non disattivati). */
export async function shareableUsers(): Promise<
  { id: number; name: string; email: string; role: "trusted" | "viewer" }[]
> {
  return query(
    `SELECT id, name, email, role FROM users WHERE role <> 'owner' AND disabled_at IS NULL ORDER BY name`,
  );
}
