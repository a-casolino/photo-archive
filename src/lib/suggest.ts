import "server-only";
import { query } from "./db";
import { albumCoverId, LINKED_EXPORT } from "./gallery";
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

/**
 * Condizione e posizione per la colonna `col`: `rank` vale 0 se il nome
 * inizia con il testo, 1 se una sua parola inizia con il testo, 2 altrimenti.
 */
function matching(col: string, q: string) {
  const e = escapeLike(q);
  return {
    where: `${col} LIKE ?`,
    whereParams: [`%${e}%`],
    rank: `CASE WHEN ${col} LIKE ? THEN 0 WHEN ${col} LIKE ? THEN 1 ELSE 2 END`,
    rankParams: [`${e}%`, `% ${e}%`],
  };
}

export async function suggest(q: string): Promise<Suggestions> {
  const albums = matching("a.title", q);
  const tags = matching("t.name", q);
  const people = matching("pe.name", q);
  const [a, t, p] = await Promise.all([
    query<AlbumSuggestion>(
      // Prima i 5 album, poi la loro copertina effettiva (come in listAlbums).
      `SELECT a.public_id, a.title, a.date_from, a.date_to, a.photo_count,
              COALESCE(x.gcs_thumb_key, p.gcs_thumb_key) AS thumb_key
         FROM (
           SELECT a.id, a.public_id, a.title, a.date_from, a.date_to,
                  (SELECT COUNT(*) FROM album_photos ap JOIN photos q ON q.id = ap.photo_id
                    WHERE ap.album_id = a.id AND q.deleted_at IS NULL) AS photo_count,
                  ${albumCoverId("a")} AS shown_cover_id,
                  ${albums.rank} AS rank_order
             FROM albums a
            WHERE a.deleted_at IS NULL AND ${albums.where}
            ORDER BY rank_order, a.title
            LIMIT ${SUGGEST_LIMIT}
         ) a
         LEFT JOIN photos p ON p.id = a.shown_cover_id
         ${LINKED_EXPORT}
        ORDER BY a.rank_order, a.title`,
      [...albums.rankParams, ...albums.whereParams],
    ),
    query<TagSuggestion>(
      `SELECT t.slug, t.name,
              (SELECT COUNT(*) FROM photo_tags pt JOIN photos p ON p.id = pt.photo_id AND p.deleted_at IS NULL
                WHERE pt.tag_id = t.id) AS photo_count,
              (SELECT COUNT(*) FROM album_tags at JOIN albums a ON a.id = at.album_id AND a.deleted_at IS NULL
                WHERE at.tag_id = t.id) AS album_count
         FROM tags t
        WHERE ${tags.where}
        ORDER BY ${tags.rank}, t.name
        LIMIT ${SUGGEST_LIMIT}`,
      [...tags.whereParams, ...tags.rankParams],
    ),
    query<PersonSuggestion>(
      `SELECT pe.public_id, pe.name,
              (SELECT COUNT(DISTINCT f.photo_id) FROM faces f JOIN photos p ON p.id = f.photo_id AND p.deleted_at IS NULL
                WHERE f.person_id = pe.id AND f.status = 'confirmed') AS photo_count,
              cf.gcs_face_key AS face_key
         FROM people pe
         LEFT JOIN faces cf ON cf.id = pe.cover_face_id
        WHERE ${people.where}
        ORDER BY ${people.rank}, pe.name
        LIMIT ${SUGGEST_LIMIT}`,
      [...people.whereParams, ...people.rankParams],
    ),
  ]);
  return { albums: a, tags: t, people: p };
}
