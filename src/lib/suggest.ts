import "server-only";
import { query } from "./db";
import { LINKED_EXPORT } from "./gallery";
import { escapeLike, SUGGEST_LIMIT } from "./search-rules";

/*
 * Suggerimenti mentre si scrive nella ricerca: album, tag e persone il
 * cui nome contiene il testo. Solo per il proprietario (tag e persone non
 * si mostrano a chi riceve condivisioni): il chiamante lo verifica.
 *
 * Il confronto usa la collation delle tabelle (utf8mb4_0900_ai_ci), quindi
 * ignora maiuscole e accenti. Prima i nomi che iniziano con il testo, poi
 * quelli con una parola che inizia con il testo, poi gli altri.
 */

export type AlbumSuggestion = {
  public_id: string;
  title: string;
  date_from: Date | null;
  date_to: Date | null;
  photo_count: number;
  thumb_key: string | null;
};

export type TagSuggestion = {
  slug: string;
  name: string;
  photo_count: number;
  album_count: number;
};

export type PersonSuggestion = {
  public_id: string;
  name: string;
  photo_count: number;
  face_key: string | null;
};

export type Suggestions = {
  albums: AlbumSuggestion[];
  tags: TagSuggestion[];
  people: PersonSuggestion[];
};

/** Condizione e ordine per la colonna `col`; parametri: contiene, ordine (inizio, parola). */
function matching(col: string, q: string) {
  const e = escapeLike(q);
  return {
    where: `${col} LIKE ?`,
    order: `CASE WHEN ${col} LIKE ? THEN 0 WHEN ${col} LIKE ? THEN 1 ELSE 2 END, ${col}`,
    whereParams: [`%${e}%`],
    orderParams: [`${e}%`, `% ${e}%`],
  };
}

export async function suggest(q: string): Promise<Suggestions> {
  const albums = matching("a.title", q);
  const tags = matching("t.name", q);
  const people = matching("pe.name", q);
  const [a, t, p] = await Promise.all([
    query<AlbumSuggestion>(
      `SELECT a.public_id, a.title, a.date_from, a.date_to,
              (SELECT COUNT(*) FROM album_photos ap JOIN photos q ON q.id = ap.photo_id
                WHERE ap.album_id = a.id AND q.deleted_at IS NULL) AS photo_count,
              COALESCE(x.gcs_thumb_key, p.gcs_thumb_key) AS thumb_key
         FROM albums a
         LEFT JOIN photos p ON p.id = a.cover_photo_id AND p.deleted_at IS NULL
         ${LINKED_EXPORT}
        WHERE a.deleted_at IS NULL AND ${albums.where}
        ORDER BY ${albums.order}
        LIMIT ${SUGGEST_LIMIT}`,
      [...albums.whereParams, ...albums.orderParams],
    ),
    query<TagSuggestion>(
      `SELECT t.slug, t.name,
              (SELECT COUNT(*) FROM photo_tags pt JOIN photos p ON p.id = pt.photo_id AND p.deleted_at IS NULL
                WHERE pt.tag_id = t.id) AS photo_count,
              (SELECT COUNT(*) FROM album_tags at JOIN albums a ON a.id = at.album_id AND a.deleted_at IS NULL
                WHERE at.tag_id = t.id) AS album_count
         FROM tags t
        WHERE ${tags.where}
        ORDER BY ${tags.order}
        LIMIT ${SUGGEST_LIMIT}`,
      [...tags.whereParams, ...tags.orderParams],
    ),
    query<PersonSuggestion>(
      `SELECT pe.public_id, pe.name,
              (SELECT COUNT(DISTINCT f.photo_id) FROM faces f JOIN photos p ON p.id = f.photo_id AND p.deleted_at IS NULL
                WHERE f.person_id = pe.id AND f.status = 'confirmed') AS photo_count,
              cf.gcs_face_key AS face_key
         FROM people pe
         LEFT JOIN faces cf ON cf.id = pe.cover_face_id
        WHERE ${people.where}
        ORDER BY ${people.order}
        LIMIT ${SUGGEST_LIMIT}`,
      [...people.whereParams, ...people.orderParams],
    ),
  ]);
  return { albums: a, tags: t, people: p };
}
