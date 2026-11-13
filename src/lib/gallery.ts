import "server-only";
import { MAX_ALBUM_DEPTH } from "./album-tree-rules";
import { query, queryOne } from "./db";
import { dateFilterSql, hasDateFilter, type DateFilter } from "./filter-rules";
import { storage } from "./storage";

/*
 * Lettura di album e foto per le gallerie (proprietario e condivisioni).
 *
 * Versione mostrata: se un CR2 ha un export JPEG collegato (Lightroom,
 * caricato su Google Foto e collegato con match 'auto' o 'confirmed'),
 * si mostra e si condivide l'anteprima dell'export al posto di quella
 * incorporata nel CR2 (requisito del 2026-11-07). Il CR2 resta l'originale.
 */

/**
 * Export collegato più recente della foto `base` (di solito `p`; alias `x`,
 * NULL se non c'è). Con "trashed" cerca quelli nel cestino (pagina Cestino).
 *
 * FORCE INDEX: quasi tutte le foto hanno `derived_from_id` NULL, quindi per
 * le statistiche di MySQL ogni valore dell'indice "vale" migliaia di righe e
 * l'ottimizzatore sceglieva di leggere tutta la tabella photos per ogni foto
 * mostrata (secondi di CPU a pagina, misurato con 40.000 foto). Con l'indice
 * la ricerca è una lettura puntuale. NOT EXISTS tiene solo l'export più
 * recente, come faceva la sottoquery `ORDER BY e.id DESC LIMIT 1`.
 */
export function linkedExport(deleted: "active" | "trashed" = "active", base = "p"): string {
  const d = deleted === "active" ? "IS NULL" : "IS NOT NULL";
  return `
  LEFT JOIN photos x FORCE INDEX (ix_photos_derived) ON x.derived_from_id = ${base}.id AND x.match_status IN ('auto', 'confirmed') AND x.deleted_at ${d}
   AND NOT EXISTS (SELECT 1 FROM photos x2 FORCE INDEX (ix_photos_derived)
                    WHERE x2.derived_from_id = ${base}.id AND x2.match_status IN ('auto', 'confirmed')
                      AND x2.deleted_at ${d} AND x2.id > x.id)`;
}

export const LINKED_EXPORT = linkedExport();

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

/**
 * Copertina effettiva dell'album `alias`: quella scelta (`cover_photo_id`) se la foto è ancora
 * nell'album e non è nel cestino, altrimenti la prima foto dell'album. Così una copertina
 * cestinata viene sostituita senza toccare il dato, e torna se la foto viene ripristinata.
 */
export function albumCoverId(alias: string): string {
  // La copertina scelta può essere anche una foto di un sotto-album (album che contengono solo sotto-album).
  return `COALESCE(
    (SELECT cp.id FROM album_photos cap JOIN photos cp ON cp.id = cap.photo_id AND cp.deleted_at IS NULL
      WHERE cap.photo_id = ${alias}.cover_photo_id
        AND (cap.album_id = ${alias}.id OR ${inSubalbums("cap.album_id", alias)})
      LIMIT 1),
    (SELECT p.id FROM album_photos ap JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
      WHERE ap.album_id = ${alias}.id ORDER BY ${ALBUM_ORDER} LIMIT 1))`;
}

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
  /** 1 finché l'originale non è arrivato (caricamento dal browser, prima le anteprime). */
  original_pending: 0 | 1;
  lens: string | null;
  focal_length_mm: string | null;
  aperture: string | null;
  exposure_time: string | null;
  iso: number | null;
  gps_lat: string | null;
  gps_lon: string | null;
  /** Luogo dal GPS ("Positano, Campania, Italia"); '' o null se non c'è. */
  place_name: string | null;
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
  parent_id: number | null;
  date_from: Date | null;
  date_to: Date | null;
  cover_photo_id: number | null;
};

export type AlbumListItem = AlbumRow & {
  /** Foto dell'album e dei suoi sotto-album, senza doppioni. */
  photo_count: number;
  child_count: number;
  /** Peso dei file originali dell'album e dei sotto-album, in byte, senza doppioni. */
  total_bytes: number;
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

/**
 * Albero degli album: per ogni album che soddisfa `anchorWhere` (alias `a`),
 * una riga (root_id, id, lvl) per lui (lvl 0) e per ogni sotto-album attivo.
 * Al massimo 3 livelli: il limite su lvl ferma anche un eventuale ciclo.
 */
export function treeCte(anchorWhere: string): string {
  return `WITH RECURSIVE tree (root_id, id, lvl) AS (
    SELECT a.id, a.id, 0 FROM albums a WHERE ${anchorWhere}
    UNION ALL
    SELECT t.root_id, c.id, t.lvl + 1 FROM tree t
      JOIN albums c ON c.parent_id = t.id AND c.deleted_at IS NULL
     WHERE t.lvl < ${MAX_ALBUM_DEPTH - 1}
  )`;
}

/**
 * Condizione SQL: l'album `col` è un sotto-album attivo (2° o 3° livello
 * sotto) dell'album `alias`. Senza CTE, così si usa anche in sottoquery
 * correlate.
 */
export function inSubalbums(col: string, alias: string): string {
  return `(${col} IN (SELECT c1.id FROM albums c1 WHERE c1.parent_id = ${alias}.id AND c1.deleted_at IS NULL)
        OR ${col} IN (SELECT c2.id FROM albums c2 JOIN albums c1 ON c1.id = c2.parent_id AND c1.deleted_at IS NULL
                       WHERE c1.parent_id = ${alias}.id AND c2.deleted_at IS NULL))`;
}

/**
 * Copertina presa dai sotto-album di `alias`, per gli album che non hanno
 * foto loro: prima le copertine scelte dei sotto-album diretti, poi la foto
 * più vecchia.
 */
export function branchCoverId(alias: string): string {
  return `(SELECT p.id FROM albums d
             JOIN album_photos ap ON ap.album_id = d.id
             JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
            WHERE ${inSubalbums("d.id", alias)}
            ORDER BY (d.parent_id = ${alias}.id) DESC, (p.id <=> d.cover_photo_id) DESC,
                     p.taken_at IS NULL, p.taken_at, p.id LIMIT 1)`;
}

/** Foto (senza doppioni) dell'album `alias` e dei suoi sotto-album. */
export function branchPhotoCount(alias: string): string {
  return `(SELECT COUNT(DISTINCT ap.photo_id) FROM album_photos ap
             JOIN photos q ON q.id = ap.photo_id AND q.deleted_at IS NULL
            WHERE ap.album_id = ${alias}.id OR ${inSubalbums("ap.album_id", alias)})`;
}

const ALBUM_COLUMNS = "id, public_id, title, description, origin, origin_ref, parent_id, date_from, date_to, cover_photo_id";

/**
 * Album con copertina, numero di foto (comprese quelle dei sotto-album) e
 * periodo (anche dei sotto-album). `parentId`: solo gli album dentro
 * quell'album (null = primo livello); se manca, tutti i livelli.
 */
export async function listAlbums(
  filter: {
    q?: string;
    origin?: AlbumRow["origin"];
    tagId?: number;
    parentId?: number | null;
    /** Solo gli album (con i sotto-album) che hanno almeno una foto scattata in quella data… */
    date?: DateFilter;
    /** …e/o in cui compare quella persona (volti confermati, nella stessa foto se c'è anche la data). */
    personId?: number;
  } = {},
): Promise<AlbumListItem[]> {
  const where = ["a.deleted_at IS NULL"];
  const params: unknown[] = [];
  if (filter.parentId !== undefined) {
    if (filter.parentId === null) where.push("a.parent_id IS NULL");
    else {
      where.push("a.parent_id = ?");
      params.push(filter.parentId);
    }
  }
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
  const date = filter.date && hasDateFilter(filter.date) ? dateFilterSql("q.taken_at", filter.date) : null;
  if (date || filter.personId) {
    const photoCond = [...(date?.sql ?? [])];
    if (filter.personId) {
      photoCond.push("EXISTS (SELECT 1 FROM faces f WHERE f.photo_id = q.id AND f.person_id = ? AND f.status = 'confirmed')");
    }
    where.push(`EXISTS (SELECT 1 FROM album_photos ap JOIN photos q ON q.id = ap.photo_id AND q.deleted_at IS NULL
                         WHERE (ap.album_id = a.id OR ${inSubalbums("ap.album_id", "a")}) AND ${photoCond.join(" AND ")})`);
    params.push(...(date?.params ?? []), ...(filter.personId ? [filter.personId] : []));
  }
  const cond = where.join(" AND ");
  // La copertina effettiva si calcola in una tabella derivata: il join su photos resta per chiave primaria.
  return query<AlbumListItem>(
    `${treeCte(cond)}
     SELECT a.id, a.public_id, a.title, a.description, a.origin, a.origin_ref, a.parent_id, a.date_from, a.date_to,
            a.cover_photo_id, a.photo_count, a.child_count, a.total_bytes,
            COALESCE(x.gcs_thumb_key, p.gcs_thumb_key) AS cover_thumb,
            IF(x.id IS NULL, p.width, x.width) AS cover_width,
            IF(x.id IS NULL, p.height, x.height) AS cover_height,
            IF(x.id IS NULL, p.orientation, x.orientation) AS cover_orientation
       FROM (
         SELECT a.id, a.public_id, a.title, a.description, a.origin, a.origin_ref, a.parent_id, a.cover_photo_id,
                (SELECT MIN(d.date_from) FROM tree t JOIN albums d ON d.id = t.id WHERE t.root_id = a.id) AS date_from,
                (SELECT MAX(d.date_to) FROM tree t JOIN albums d ON d.id = t.id WHERE t.root_id = a.id) AS date_to,
                (SELECT COUNT(DISTINCT ap.photo_id) FROM tree t
                   JOIN album_photos ap ON ap.album_id = t.id
                   JOIN photos q ON q.id = ap.photo_id AND q.deleted_at IS NULL
                  WHERE t.root_id = a.id) AS photo_count,
                (SELECT COALESCE(SUM(q.file_size), 0) FROM photos q
                  WHERE q.deleted_at IS NULL AND q.id IN (
                    SELECT ap.photo_id FROM tree t JOIN album_photos ap ON ap.album_id = t.id WHERE t.root_id = a.id)
                ) AS total_bytes,
                (SELECT COUNT(*) FROM albums c WHERE c.parent_id = a.id AND c.deleted_at IS NULL) AS child_count,
                COALESCE(${albumCoverId("a")}, ${branchCoverId("a")}) AS shown_cover_id
           FROM albums a
          WHERE ${cond}
       ) a
       LEFT JOIN photos p ON p.id = a.shown_cover_id
       ${LINKED_EXPORT}
      ORDER BY a.date_from IS NULL, a.date_from DESC, a.title`,
    [...params, ...params],
  );
}

export async function getAlbum(publicId: string): Promise<AlbumRow | null> {
  return queryOne<AlbumRow>(`SELECT ${ALBUM_COLUMNS} FROM albums WHERE public_id = ? AND deleted_at IS NULL`, [
    publicId,
  ]);
}

export async function getAlbumById(id: number): Promise<AlbumRow | null> {
  return queryOne<AlbumRow>(`SELECT ${ALBUM_COLUMNS} FROM albums WHERE id = ? AND deleted_at IS NULL`, [id]);
}

// ---------------------------------------------------------------------
// Sotto-album
// ---------------------------------------------------------------------

export type AlbumCrumb = { id: number; public_id: string; title: string };

/**
 * Percorso dell'album: gli album che lo contengono, dal primo livello, e
 * lui per ultimo. Con `stopAt` il percorso parte da quell'album (per chi
 * riceve una condivisione: niente di quello che sta sopra).
 */
export async function albumPath(albumId: number, stopAt?: number): Promise<AlbumCrumb[]> {
  const out: AlbumCrumb[] = [];
  for (let cur: number | null = albumId; cur !== null && out.length < MAX_ALBUM_DEPTH; ) {
    const row: (AlbumCrumb & { parent_id: number | null }) | null = await queryOne(
      "SELECT id, public_id, title, parent_id FROM albums WHERE id = ? AND deleted_at IS NULL",
      [cur],
    );
    if (!row) break;
    out.unshift({ id: row.id, public_id: row.public_id, title: row.title });
    if (row.id === stopAt) break;
    cur = row.parent_id;
  }
  return out;
}

/** L'album sta nel ramo di `rootId` (o è lui)? Serve alle condivisioni. */
export async function isAlbumInBranch(rootId: number, albumId: number): Promise<boolean> {
  const path = await albumPath(albumId, rootId);
  return path.length > 0 && path[0].id === rootId;
}

/** Numero di foto (senza doppioni) e di sotto-album del ramo, e periodo. */
export async function albumBranchSummary(
  albumId: number,
): Promise<{ photos: number; children: number; date_from: Date | null; date_to: Date | null }> {
  const row = await queryOne<{ photos: number; children: number; date_from: Date | null; date_to: Date | null }>(
    `${treeCte("a.id = ?")}
     SELECT (SELECT COUNT(DISTINCT ap.photo_id) FROM tree t
               JOIN album_photos ap ON ap.album_id = t.id
               JOIN photos q ON q.id = ap.photo_id AND q.deleted_at IS NULL) AS photos,
            (SELECT COUNT(*) FROM albums c WHERE c.parent_id = ? AND c.deleted_at IS NULL) AS children,
            (SELECT MIN(d.date_from) FROM tree t JOIN albums d ON d.id = t.id) AS date_from,
            (SELECT MAX(d.date_to) FROM tree t JOIN albums d ON d.id = t.id) AS date_to`,
    [albumId, albumId],
  );
  return {
    photos: Number(row?.photos ?? 0),
    children: Number(row?.children ?? 0),
    date_from: row?.date_from ?? null,
    date_to: row?.date_to ?? null,
  };
}

/** Tutti gli album attivi, per "Sposta in…" e per i controlli sull'albero. */
export async function albumTreeIndex(): Promise<{ id: number; public_id: string; title: string; parent_id: number | null }[]> {
  return query("SELECT id, public_id, title, parent_id FROM albums WHERE deleted_at IS NULL ORDER BY title");
}

/** Copertina mostrata per l'album e se è stata scelta a mano (o è la prima foto). */
export async function getAlbumCover(
  album: Pick<AlbumRow, "id" | "cover_photo_id">,
): Promise<{ public_id: string; thumb_key: string | null; chosen: boolean } | null> {
  const row = await queryOne<{ id: number; public_id: string; thumb_key: string | null }>(
    `SELECT p.id, p.public_id, COALESCE(x.gcs_thumb_key, p.gcs_thumb_key) AS thumb_key
       FROM (SELECT COALESCE(${albumCoverId("a")}, ${branchCoverId("a")}) AS shown_cover_id
               FROM albums a WHERE a.id = ?) a
       JOIN photos p ON p.id = a.shown_cover_id
       ${LINKED_EXPORT}`,
    [album.id],
  );
  return row ? { public_id: row.public_id, thumb_key: row.thumb_key, chosen: row.id === album.cover_photo_id } : null;
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

/**
 * Foto della presentazione (slideshow) di un album. Con `branch` anche
 * quelle dei sotto-album, senza doppioni e in ordine di scatto (l'ordine
 * manuale vale dentro un solo album); senza, nell'ordine dell'album.
 */
export async function slideshowPhotos(
  albumId: number,
  opts: { branch: boolean; onlyEdited: boolean; offset: number; limit: number },
): Promise<{ total: number; photos: PhotoCard[] }> {
  if (!opts.branch) {
    const [counts, photos] = await Promise.all([
      albumCounts(albumId),
      albumPhotos(albumId, { onlyEdited: opts.onlyEdited, offset: opts.offset, limit: opts.limit }),
    ]);
    return { total: opts.onlyEdited ? counts.edited : counts.total, photos };
  }
  const edited = opts.onlyEdited ? "AND x.id IS NOT NULL" : "";
  const inBranch = `p.id IN (SELECT ap.photo_id FROM tree t JOIN album_photos ap ON ap.album_id = t.id)`;
  const [count, photos] = await Promise.all([
    queryOne<{ n: number }>(
      `${treeCte("a.id = ? AND a.deleted_at IS NULL")}
       SELECT COUNT(*) AS n FROM photos p ${LINKED_EXPORT}
        WHERE p.deleted_at IS NULL AND ${inBranch} ${edited}`,
      [albumId],
    ),
    query<PhotoCard>(
      `${treeCte("a.id = ? AND a.deleted_at IS NULL")}
       SELECT ${CARD_COLUMNS} FROM photos p ${LINKED_EXPORT}
        WHERE p.deleted_at IS NULL AND ${inBranch} ${edited}
        ORDER BY p.taken_at IS NULL, p.taken_at, p.taken_at_subsec, p.id
        LIMIT ? OFFSET ?`,
      [albumId, opts.limit, opts.offset],
    ),
  ]);
  return { total: Number(count?.n ?? 0), photos };
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

/** La foto sta nell'album o in uno dei suoi sotto-album? */
export async function isPhotoInBranch(albumId: number, photoId: number): Promise<boolean> {
  const row = await queryOne<{ ok: number }>(
    `${treeCte("a.id = ? AND a.deleted_at IS NULL")}
     SELECT 1 AS ok FROM tree t
       JOIN album_photos ap ON ap.album_id = t.id AND ap.photo_id = ?
       JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
      LIMIT 1`,
    [albumId, photoId],
  );
  return !!row;
}

/** Album (non cancellati) che contengono la foto: per il proprietario. */
export async function albumsOfPhoto(
  photoId: number,
): Promise<{ public_id: string; title: string; is_cover: number }[]> {
  return query(
    `SELECT a.public_id, a.title, (a.cover_photo_id <=> ap.photo_id) AS is_cover FROM album_photos ap JOIN albums a ON a.id = ap.album_id AND a.deleted_at IS NULL
      WHERE ap.photo_id = ? ORDER BY a.title`,
    [photoId],
  );
}

/**
 * Album che contengono gli album della foto (fino al primo livello): la
 * foto può farne da copertina anche se non sta direttamente lì.
 */
export async function albumsAbovePhoto(
  photoId: number,
): Promise<{ public_id: string; title: string; is_cover: number; child_public_id: string }[]> {
  return query(
    `SELECT DISTINCT u.public_id, u.title, (u.cover_photo_id <=> ap.photo_id) AS is_cover, a.public_id AS child_public_id
       FROM album_photos ap
       JOIN albums a ON a.id = ap.album_id AND a.deleted_at IS NULL
       JOIN albums u ON u.deleted_at IS NULL AND (
            u.id = a.parent_id
         OR u.id = (SELECT m.parent_id FROM albums m WHERE m.id = a.parent_id AND m.deleted_at IS NULL))
      WHERE ap.photo_id = ?
      ORDER BY u.title`,
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
            p.file_size, p.mime_type, p.gcs_original_key AS original_key, p.original_pending, p.lens, p.focal_length_mm,
            p.aperture, p.exposure_time, p.iso, p.gps_lat, p.gps_lon, p.place_name, p.description, p.match_status,
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

/** URL firmati (brevi, o di `ttlSeconds`) per un elenco di chiavi, senza doppioni. */
export async function signKeys(
  keys: (string | null | undefined)[],
  ttlSeconds?: number,
): Promise<Map<string, string>> {
  const s = storage();
  const urls = new Map<string, string>();
  await Promise.all(
    [...new Set(keys.filter((k): k is string => !!k))].map(async (k) => {
      try {
        urls.set(k, await s.readUrl(k, ttlSeconds));
      } catch (e) {
        // Archivio non configurato (es. bucket non ancora creato): la
        // pagina si vede lo stesso, con i segnaposto.
        console.error("[gallery] URL non firmato", k, e);
      }
    }),
  );
  return urls;
}
