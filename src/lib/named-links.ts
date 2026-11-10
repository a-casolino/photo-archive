import "server-only";
import { execute, query, queryOne } from "./db";
import { appUrl } from "./mail";
import { SLUG_MAX } from "./named-link-rules";
import type { ShareRow } from "./shares";

/*
 * Link con nome: /l/<nome>, perpetui, con la destinazione che il
 * proprietario cambia quando vuole (un album oggi, una foto domani).
 * Per chi lo apre valgono come un link libero: si legge una ShareRow
 * "virtuale" (mode 'link', nessuna scadenza) e si riusano le stesse
 * pagine e lo stesso download. Mai gli originali.
 */

export type NamedLinkRow = {
  id: number;
  public_id: string;
  slug: string;
  photo_id: number | null;
  album_id: number | null;
  allow_download: "none" | "preview";
  disabled_at: Date | null;
  created_at: Date;
  pointed_at: Date;
  view_count: number;
  last_viewed_at: Date | null;
};

const COLUMNS = `nl.id, nl.public_id, nl.slug, nl.photo_id, nl.album_id, nl.allow_download, nl.disabled_at,
  nl.created_at, nl.pointed_at, nl.view_count, nl.last_viewed_at`;

/** La destinazione esiste e non è nel cestino. */
const TARGET_LIVE = `(
  (nl.album_id IS NOT NULL AND EXISTS (SELECT 1 FROM albums a WHERE a.id = nl.album_id AND a.deleted_at IS NULL)) OR
  (nl.photo_id IS NOT NULL AND EXISTS (SELECT 1 FROM photos p WHERE p.id = nl.photo_id AND p.deleted_at IS NULL))
)`;

export function namedLinkUrl(slug: string): string {
  return appUrl(`/l/${slug}`);
}

/** Il link con nome come condivisione libera, se è attivo e punta a qualcosa di vivo. */
export async function getNamedLinkShare(slug: string): Promise<ShareRow | null> {
  const s = slug.toLowerCase();
  if (s.length > SLUG_MAX) return null;
  const nl = await queryOne<NamedLinkRow>(
    `SELECT ${COLUMNS} FROM named_links nl WHERE nl.slug = ? AND nl.disabled_at IS NULL AND ${TARGET_LIVE}`,
    [s],
  );
  if (!nl) return null;
  return {
    id: nl.id,
    public_id: nl.public_id,
    target_type: nl.album_id !== null ? "album" : "photo",
    photo_id: nl.album_id !== null ? null : nl.photo_id,
    album_id: nl.album_id,
    mode: "link",
    message: null,
    allow_download: nl.allow_download,
    expires_at: null,
    revoked_at: null,
    created_at: nl.created_at,
    view_count: nl.view_count,
    last_viewed_at: nl.last_viewed_at,
    named_link_id: nl.id,
  };
}

export async function recordNamedLinkView(id: number) {
  await execute(
    "UPDATE named_links SET view_count = view_count + 1, last_viewed_at = UTC_TIMESTAMP() WHERE id = ?",
    [id],
  );
}

export type NamedLinkItem = NamedLinkRow & {
  url: string;
  target_type: "album" | "photo" | null;
  target_title: string | null;
  target_public_id: string | null;
  /** La destinazione è nel cestino. */
  target_trashed: boolean;
};

/** Tutti i link con nome, per la pagina Link e per la finestra Condividi (solo proprietario). */
export async function listNamedLinks(): Promise<NamedLinkItem[]> {
  const rows = await query<
    NamedLinkRow & {
      a_title: string | null;
      a_pid: string | null;
      a_deleted: Date | null;
      p_title: string | null;
      p_pid: string | null;
      p_deleted: Date | null;
    }
  >(
    `SELECT ${COLUMNS},
            a.title AS a_title, a.public_id AS a_pid, a.deleted_at AS a_deleted,
            COALESCE(p.title, p.original_filename) AS p_title, p.public_id AS p_pid, p.deleted_at AS p_deleted
       FROM named_links nl
       LEFT JOIN albums a ON a.id = nl.album_id
       LEFT JOIN photos p ON p.id = nl.photo_id
      ORDER BY nl.disabled_at IS NOT NULL, nl.slug`,
  );
  return rows.map(({ a_title, a_pid, a_deleted, p_title, p_pid, p_deleted, ...r }) => {
    const isAlbum = r.album_id !== null;
    const isPhoto = !isAlbum && r.photo_id !== null;
    return {
      ...r,
      url: namedLinkUrl(r.slug),
      target_type: isAlbum ? "album" : isPhoto ? "photo" : null,
      target_title: isAlbum ? a_title : isPhoto ? p_title : null,
      target_public_id: isAlbum ? a_pid : isPhoto ? p_pid : null,
      target_trashed: isAlbum ? a_deleted !== null : isPhoto ? p_deleted !== null : false,
    };
  });
}
