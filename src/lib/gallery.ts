import "server-only";
import { query, queryOne } from "./db";
import { storage } from "./storage";

/*
 * Lettura di album e foto per le gallerie (proprietario e condivisioni).
 *
 * Versione mostrata: se un CR2 ha un export JPEG collegato (Lightroom,
 * caricato su Google Foto e collegato con match 'auto' o 'confirmed'),
 * si mostra e si condivide l'anteprima dell'export al posto di quella
 * incorporata nel CR2 (requisito del 2026-11-07). Il CR2 resta l'originale.
 */

/** Export collegato più recente della foto `p` (alias `x`, NULL se non c'è). */
export const LINKED_EXPORT = `
  LEFT JOIN photos x ON x.id = (
    SELECT e.id FROM photos e
     WHERE e.derived_from_id = p.id AND e.match_status IN ('auto', 'confirmed') AND e.deleted_at IS NULL
     ORDER BY e.id DESC LIMIT 1)`;

export const CARD_COLUMNS = `
  p.id, p.public_id, p.kind, p.original_filename, p.title, p.taken_at, p.taken_at_subsec,
  IF(x.id IS NULL, p.width, x.width) AS width,
  IF(x.id IS NULL, p.height, x.height) AS height,
  IF(x.id IS NULL, p.orientation, x.orientation) AS orientation,
  COALESCE(x.gcs_thumb_key, p.gcs_thumb_key) AS thumb_key,
  COALESCE(x.gcs_preview_key, p.gcs_preview_key) AS preview_key,
  x.id IS NOT NULL AS edited`;

/** Ordine delle foto in un album: posizione manuale, poi data di scatto. */
const ALBUM_ORDER = "ap.position, p.taken_at IS NULL, p.taken_at, p.taken_at_subsec, p.id";

export type PhotoCard = {
  id: number;
  public_id: string;
  kind: "raw" | "phone" | "edit";
  original_filename: string;
  title: string | null;
  taken_at: Date | null;
  taken_at_subsec: number | null;
  width: number | null;
  height: number | null;
  orientation: number | null;
  thumb_key: string | null;
  preview_key: string | null;
  edited: 0 | 1;
};

export type PhotoDetail = PhotoCard & {
  file_size: number;
  mime_type: string;
  original_key: string;
  lens: string | null;
  focal_length_mm: string | null;
  aperture: string | null;
  exposure_time: string | null;
  iso: number | null;
  gps_lat: string | null;
  gps_lon: string | null;
  description: string | null;
  camera_make: string | null;
  camera_model: string | null;
  camera_name: string | null;
  match_status: "none" | "auto" | "confirmed" | "rejected";
  derived_from_public_id: string | null;
  export_public_id: string | null;
  export_filename: string | null;
};

export type AlbumRow = {
  id: number;
  public_id: string;
  title: string;
  description: string | null;
  origin: "disk_folder" | "google_photos" | "manual";
  origin_ref: string | null;
  date_from: Date | null;
  date_to: Date | null;
  cover_photo_id: number | null;
};

export type AlbumListItem = AlbumRow & {
  photo_count: number;
  cover_thumb: string | null;
  cover_width: number | null;
  cover_height: number | null;
  cover_orientation: number | null;
};

export const ORIGIN_LABEL: Record<AlbumRow["origin"], string> = {
  disk_folder: "Cartella del disco",
  google_photos: "Google Foto",
  manual: "Creato a mano",
};

// ---------------------------------------------------------------------
// Album
// ---------------------------------------------------------------------

export async function listAlbums(
  filter: { q?: string; origin?: AlbumRow["origin"]; tagId?: number } = {},
): Promise<AlbumListItem[]> {
  const where = ["a.deleted_at IS NULL"];
  const params: unknown[] = [];
  if (filter.q) {
    // Titolo, cartella d'origine o un tag dell'album.
    where.push(`(a.title LIKE ? OR a.origin_ref LIKE ? OR EXISTS (
      SELECT 1 FROM album_tags at JOIN tags t ON t.id = at.tag_id WHERE at.album_id = a.id AND t.name LIKE ?))`);
    const like = `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like);
  }
  if (filter.tagId) {
    where.push("EXISTS (SELECT 1 FROM album_tags at WHERE at.album_id = a.id AND at.tag_id = ?)");
    params.push(filter.tagId);
  }
  if (filter.origin) {
    where.push("a.origin = ?");
    params.push(filter.origin);
  }
  return query<AlbumListItem>(
    `SELECT a.id, a.public_id, a.title, a.description, a.origin, a.origin_ref, a.date_from, a.date_to,
            a.cover_photo_id,
            (SELECT COUNT(*) FROM album_photos ap JOIN photos q ON q.id = ap.photo_id
              WHERE ap.album_id = a.id AND q.deleted_at IS NULL) AS photo_count,
            COALESCE(x.gcs_thumb_key, p.gcs_thumb_key) AS cover_thumb,
            IF(x.id IS NULL, p.width, x.width) AS cover_width,
            IF(x.id IS NULL, p.height, x.height) AS cover_height,
            IF(x.id IS NULL, p.orientation, x.orientation) AS cover_orientation
       FROM albums a
       LEFT JOIN photos p ON p.id = a.cover_photo_id AND p.deleted_at IS NULL
       ${LINKED_EXPORT}
      WHERE ${where.join(" AND ")}
      ORDER BY a.date_from IS NULL, a.date_from DESC, a.title`,
    params,
  );
}

export async function getAlbum(publicId: string): Promise<AlbumRow | null> {
  return queryOne<AlbumRow>(
    `SELECT id, public_id, title, description, origin, origin_ref, date_from, date_to, cover_photo_id
       FROM albums WHERE public_id = ? AND deleted_at IS NULL`,
    [publicId],
  );
}

export async function getAlbumById(id: number): Promise<AlbumRow | null> {
  return queryOne<AlbumRow>(
    `SELECT id, public_id, title, description, origin, origin_ref, date_from, date_to, cover_photo_id
       FROM albums WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
}

export async function albumCounts(albumId: number): Promise<{ total: number; edited: number }> {
  const row = await queryOne<{ total: number; edited: number | null }>(
    `SELECT COUNT(*) AS total, SUM(x.id IS NOT NULL) AS edited
       FROM album_photos ap
       JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
       ${LINKED_EXPORT}
      WHERE ap.album_id = ?`,
    [albumId],
  );
  return { total: Number(row?.total ?? 0), edited: Number(row?.edited ?? 0) };
}

export async function albumPhotos(
  albumId: number,
  opts: { onlyEdited?: boolean; offset?: number; limit?: number } = {},
): Promise<PhotoCard[]> {
  return query<PhotoCard>(
    `SELECT ${CARD_COLUMNS}
       FROM album_photos ap
       JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
       ${LINKED_EXPORT}
      WHERE ap.album_id = ? ${opts.onlyEdited ? "AND x.id IS NOT NULL" : ""}
      ORDER BY ${ALBUM_ORDER}
      LIMIT ? OFFSET ?`,
    [albumId, opts.limit ?? 200, opts.offset ?? 0],
  );
}

/** Foto precedente e successiva nell'album (con lo stesso filtro), e posizione. */
export async function albumNeighbors(
  albumId: number,
  photoId: number,
  onlyEdited = false,
): Promise<{ prev: string | null; next: string | null; index: number; total: number } | null> {
  const row = await queryOne<{ prev_id: string | null; next_id: string | null; rn: number; total: number }>(
    `SELECT prev_id, next_id, rn, total FROM (
       SELECT p.id,
              LAG(p.public_id)  OVER w AS prev_id,
              LEAD(p.public_id) OVER w AS next_id,
              ROW_NUMBER()      OVER w AS rn,
              COUNT(*) OVER ()         AS total
         FROM album_photos ap
         JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
         ${LINKED_EXPORT}
        WHERE ap.album_id = ? ${onlyEdited ? "AND x.id IS NOT NULL" : ""}
       WINDOW w AS (ORDER BY ${ALBUM_ORDER})
     ) t WHERE t.id = ?`,
    [albumId, photoId],
  );
  if (!row) return null;
  return { prev: row.prev_id, next: row.next_id, index: Number(row.rn), total: Number(row.total) };
}

export async function isPhotoInAlbum(albumId: number, photoId: number): Promise<boolean> {
  const row = await queryOne<{ ok: number }>(
    `SELECT 1 AS ok FROM album_photos ap JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
      WHERE ap.album_id = ? AND ap.photo_id = ?`,
    [albumId, photoId],
  );
  return !!row;
}

/** Album (non cancellati) che contengono la foto: per il proprietario. */
export async function albumsOfPhoto(photoId: number): Promise<{ public_id: string; title: string }[]> {
  return query(
    `SELECT a.public_id, a.title FROM album_photos ap JOIN albums a ON a.id = ap.album_id AND a.deleted_at IS NULL
      WHERE ap.photo_id = ? ORDER BY a.title`,
    [photoId],
  );
}

// ---------------------------------------------------------------------
// Foto
// ---------------------------------------------------------------------

export async function getPhoto(publicId: string): Promise<PhotoDetail | null> {
  if (!/^[0-9A-Za-z]{22}$/.test(publicId)) return null;
  return photoBy("p.public_id", publicId);
}

export async function getPhotoById(id: number): Promise<PhotoDetail | null> {
  return photoBy("p.id", id);
}

async function photoBy(column: "p.public_id" | "p.id", value: string | number): Promise<PhotoDetail | null> {
  return queryOne<PhotoDetail>(
    `SELECT ${CARD_COLUMNS},
            p.file_size, p.mime_type, p.gcs_original_key AS original_key, p.lens, p.focal_length_mm,
            p.aperture, p.exposure_time, p.iso, p.gps_lat, p.gps_lon, p.description, p.match_status,
            c.make AS camera_make, c.model AS camera_model, c.display_name AS camera_name,
            d.public_id AS derived_from_public_id,
            x.public_id AS export_public_id, x.original_filename AS export_filename
       FROM photos p
       ${LINKED_EXPORT}
       LEFT JOIN cameras c ON c.id = p.camera_id
       LEFT JOIN photos d ON d.id = p.derived_from_id AND d.deleted_at IS NULL
                         AND p.match_status IN ('auto', 'confirmed')
      WHERE ${column} = ? AND p.deleted_at IS NULL`,
    [value],
  );
}

/** URL firmati (brevi) per un elenco di chiavi, senza doppioni. */
export async function signKeys(keys: (string | null | undefined)[]): Promise<Map<string, string>> {
  const s = storage();
  const urls = new Map<string, string>();
  await Promise.all(
    [...new Set(keys.filter((k): k is string => !!k))].map(async (k) => {
      try {
        urls.set(k, await s.readUrl(k));
      } catch (e) {
        // Archivio non configurato (es. bucket non ancora creato): la
        // pagina si vede lo stesso, con i segnaposto.
        console.error("[gallery] URL non firmato", k, e);
      }
    }),
  );
  return urls;
}
