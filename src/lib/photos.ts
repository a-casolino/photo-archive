import "server-only";
import { query, queryOne } from "./db";
import { dateFilterSql, type DateFilter } from "./filter-rules";
import { CARD_COLUMNS, LINKED_EXPORT, type AlbumRow, type PhotoCard } from "./gallery";
import { escapeLike } from "./search-rules";

/*
 * Pagina Foto del proprietario: tutte le foto dell'archivio con i filtri
 * (ricerca, data di scatto, tag, origine, regolazioni, persona). I
 * chiamanti fanno requireOwner(): ricerca e filtro per persona usano i nomi
 * delle persone, che vede solo il proprietario.
 *
 * Un export di Lightroom collegato a un CR2 è la stessa foto: si mostra solo
 * il CR2 (nella versione dell'export, come negli album).
 */

export type PhotoFilter = {
  q?: string;
  date?: DateFilter;
  tagId?: number;
  origin?: AlbumRow["origin"];
  onlyEdited?: boolean;
  personId?: number;
};

/** Le foto di `p` e del suo export mostrato `x` (per tag, album e volti). */
const SELF_OR_EXPORT = "(p.id, x.id)";

function photoWhere(f: PhotoFilter): { where: string; params: unknown[] } {
  const where = [
    "p.deleted_at IS NULL",
    `NOT EXISTS (SELECT 1 FROM photos d WHERE d.id = p.derived_from_id AND d.deleted_at IS NULL
                   AND p.match_status IN ('auto', 'confirmed'))`,
  ];
  const params: unknown[] = [];
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    where.push(`(p.original_filename LIKE ? OR p.title LIKE ? OR p.description LIKE ?
      OR EXISTS (SELECT 1 FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id
                  WHERE pt.photo_id IN ${SELF_OR_EXPORT} AND t.name LIKE ?)
      OR EXISTS (SELECT 1 FROM album_photos ap JOIN albums a ON a.id = ap.album_id AND a.deleted_at IS NULL
                  WHERE ap.photo_id IN ${SELF_OR_EXPORT} AND a.title LIKE ?)
      OR EXISTS (SELECT 1 FROM faces f JOIN people pe ON pe.id = f.person_id
                  WHERE f.photo_id IN ${SELF_OR_EXPORT} AND f.status = 'confirmed' AND pe.name LIKE ?))`);
    params.push(like, like, like, like, like, like);
  }
  if (f.date) {
    const d = dateFilterSql("p.taken_at", f.date);
    where.push(...d.sql);
    params.push(...d.params);
  }
  if (f.tagId) {
    where.push(`EXISTS (SELECT 1 FROM photo_tags pt WHERE pt.photo_id IN ${SELF_OR_EXPORT} AND pt.tag_id = ?)`);
    params.push(f.tagId);
  }
  if (f.origin) {
    where.push(`EXISTS (SELECT 1 FROM album_photos ap JOIN albums a ON a.id = ap.album_id AND a.deleted_at IS NULL
                         WHERE ap.photo_id IN ${SELF_OR_EXPORT} AND a.origin = ?)`);
    params.push(f.origin);
  }
  if (f.onlyEdited) where.push("x.id IS NOT NULL");
  if (f.personId) {
    where.push(`EXISTS (SELECT 1 FROM faces f WHERE f.photo_id IN ${SELF_OR_EXPORT}
                         AND f.person_id = ? AND f.status = 'confirmed')`);
    params.push(f.personId);
  }
  return { where: where.join(" AND "), params };
}

/** Dalla più recente; senza data in fondo. */
const PHOTO_ORDER = "p.taken_at IS NULL, p.taken_at DESC, p.taken_at_subsec DESC, p.id DESC";

export async function listPhotos(f: PhotoFilter, offset: number, limit: number): Promise<PhotoCard[]> {
  const { where, params } = photoWhere(f);
  return query<PhotoCard>(
    `SELECT ${CARD_COLUMNS} FROM photos p ${LINKED_EXPORT}
      WHERE ${where}
      ORDER BY ${PHOTO_ORDER}
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
}

export async function countPhotos(f: PhotoFilter): Promise<number> {
  const { where, params } = photoWhere(f);
  const row = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM photos p ${LINKED_EXPORT} WHERE ${where}`, params);
  return Number(row?.n ?? 0);
}

/** Foto precedente e successiva con gli stessi filtri, e posizione. */
export async function photoNeighbors(
  f: PhotoFilter,
  photoId: number,
): Promise<{ prev: string | null; next: string | null; index: number; total: number } | null> {
  const { where, params } = photoWhere(f);
  const row = await queryOne<{ prev_id: string | null; next_id: string | null; rn: number; total: number }>(
    `SELECT prev_id, next_id, rn, total FROM (
       SELECT p.id,
              LAG(p.public_id)  OVER w AS prev_id,
              LEAD(p.public_id) OVER w AS next_id,
              ROW_NUMBER()      OVER w AS rn,
              COUNT(*) OVER ()         AS total
         FROM photos p ${LINKED_EXPORT}
        WHERE ${where}
       WINDOW w AS (ORDER BY ${PHOTO_ORDER})
     ) t WHERE t.id = ?`,
    [...params, photoId],
  );
  if (!row) return null;
  return { prev: row.prev_id, next: row.next_id, index: Number(row.rn), total: Number(row.total) };
}

/** Anni in cui ci sono foto (per il filtro di data), dal più recente. */
export async function photoYears(): Promise<number[]> {
  const rows = await query<{ y: number }>(
    `SELECT DISTINCT YEAR(taken_at) AS y FROM photos
      WHERE deleted_at IS NULL AND taken_at IS NOT NULL ORDER BY y DESC`,
  );
  return rows.map((r) => Number(r.y));
}
