import "server-only";
import { execute, query, queryOne } from "./db";
import { CARD_COLUMNS, LINKED_EXPORT, type PhotoCard } from "./gallery";
import { tagSlug } from "./gallery-rules";

/*
 * Tag liberi su foto e album (migrazione 006). Per ora solo il
 * proprietario li vede e li modifica: i chiamanti fanno requireOwner().
 */

export type Tag = { id: number; name: string; slug: string };
export type TagWithCounts = Tag & { photo_count: number; album_count: number };
export type TagTarget = { kind: "photo" | "album"; id: number };

const TABLE = { photo: "photo_tags", album: "album_tags" } as const;
const COLUMN = { photo: "photo_id", album: "album_id" } as const;

export async function listTags(): Promise<TagWithCounts[]> {
  return query<TagWithCounts>(
    `SELECT t.id, t.name, t.slug,
            (SELECT COUNT(*) FROM photo_tags pt JOIN photos p ON p.id = pt.photo_id AND p.deleted_at IS NULL
              WHERE pt.tag_id = t.id) AS photo_count,
            (SELECT COUNT(*) FROM album_tags at JOIN albums a ON a.id = at.album_id AND a.deleted_at IS NULL
              WHERE at.tag_id = t.id) AS album_count
       FROM tags t ORDER BY t.name`,
  );
}

export async function getTag(slug: string): Promise<Tag | null> {
  return queryOne<Tag>("SELECT id, name, slug FROM tags WHERE slug = ?", [slug]);
}

export async function tagsOf(target: TagTarget): Promise<Tag[]> {
  return query<Tag>(
    `SELECT t.id, t.name, t.slug FROM ${TABLE[target.kind]} x JOIN tags t ON t.id = x.tag_id
      WHERE x.${COLUMN[target.kind]} = ? ORDER BY t.name`,
    [target.id],
  );
}

/** Aggiunge i tag (creandoli se non esistono). Restituisce quanti erano nuovi per l'elemento. */
export async function addTags(target: TagTarget, names: string[]): Promise<number> {
  let added = 0;
  for (const name of names) {
    const slug = tagSlug(name);
    if (!slug) continue;
    const res = await execute(
      "INSERT INTO tags (name, slug) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
      [name, slug],
    );
    const link = await execute(
      `INSERT IGNORE INTO ${TABLE[target.kind]} (${COLUMN[target.kind]}, tag_id) VALUES (?, ?)`,
      [target.id, res.insertId],
    );
    added += link.affectedRows;
  }
  return added;
}

export async function removeTag(target: TagTarget, tagId: number) {
  await execute(`DELETE FROM ${TABLE[target.kind]} WHERE ${COLUMN[target.kind]} = ? AND tag_id = ?`, [
    target.id,
    tagId,
  ]);
}

export async function renameTag(tagId: number, name: string): Promise<{ slug: string } | { error: string }> {
  const slug = tagSlug(name);
  if (!slug) return { error: "Il nome non può essere vuoto." };
  const other = await queryOne<{ id: number }>("SELECT id FROM tags WHERE slug = ? AND id <> ?", [slug, tagId]);
  if (other) return { error: "Esiste già un tag con questo nome." };
  await execute("UPDATE tags SET name = ?, slug = ? WHERE id = ?", [name, slug, tagId]);
  return { slug };
}

export async function deleteTag(tagId: number) {
  await execute("DELETE FROM tags WHERE id = ?", [tagId]);
}

export async function countPhotosWithTag(tagId: number): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM photo_tags pt JOIN photos p ON p.id = pt.photo_id AND p.deleted_at IS NULL
      WHERE pt.tag_id = ?`,
    [tagId],
  );
  return Number(row?.n ?? 0);
}

/** Foto con il tag, per data di scatto (nella versione mostrata, come negli album). */
export async function photosWithTag(tagId: number, offset: number, limit: number): Promise<PhotoCard[]> {
  return query<PhotoCard>(
    `SELECT ${CARD_COLUMNS}
       FROM photo_tags pt
       JOIN photos p ON p.id = pt.photo_id AND p.deleted_at IS NULL
       ${LINKED_EXPORT}
      WHERE pt.tag_id = ?
      ORDER BY p.taken_at IS NULL, p.taken_at, p.taken_at_subsec, p.id
      LIMIT ? OFFSET ?`,
    [tagId, limit, offset],
  );
}
