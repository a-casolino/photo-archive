import "server-only";
import { randomBase62 } from "./crypto";
import { execute, pool, query, queryOne } from "./db";
import { centroid } from "./faces/cluster";
import { decodeEmbedding, encodeEmbedding } from "./faces/embedding";
import { CARD_COLUMNS, LINKED_EXPORT, type PhotoCard } from "./gallery";

/*
 * Persone e volti per le pagine del proprietario. I chiamanti fanno
 * requireOwner(). Le impronte (faces.embedding) non escono mai da qui:
 * le query per le pagine non le selezionano.
 */

export type Person = {
  id: number;
  public_id: string;
  name: string;
  cover_face_id: number | null;
};

export type PersonListItem = Person & {
  photo_count: number;
  suggested_count: number;
  cover_key: string | null;
};

/** Volto da mostrare: miniatura e foto di provenienza, niente impronta. */
export type FaceTile = {
  id: number;
  face_key: string | null;
  photo_public_id: string;
  photo_filename: string;
  taken_at: Date | null;
  suggest_score: number | null;
};

const FACE_TILE = `f.id, f.gcs_face_key AS face_key, p.public_id AS photo_public_id,
  p.original_filename AS photo_filename, p.taken_at, f.suggest_score`;

// ---------------------------------------------------------------------
// Letture
// ---------------------------------------------------------------------

export async function listPeople(): Promise<PersonListItem[]> {
  return query<PersonListItem>(
    `SELECT pe.id, pe.public_id, pe.name, pe.cover_face_id,
            (SELECT COUNT(DISTINCT f.photo_id) FROM faces f JOIN photos p ON p.id = f.photo_id AND p.deleted_at IS NULL
              WHERE f.person_id = pe.id AND f.status = 'confirmed') AS photo_count,
            (SELECT COUNT(*) FROM faces f WHERE f.person_id = pe.id AND f.status = 'suggested') AS suggested_count,
            cf.gcs_face_key AS cover_key
       FROM people pe
       LEFT JOIN faces cf ON cf.id = pe.cover_face_id
      ORDER BY pe.name`,
  );
}

/** Persone con almeno una foto confermata, per i filtri (solo proprietario). */
export async function peopleOptions(): Promise<{ id: number; public_id: string; name: string }[]> {
  return query(
    `SELECT pe.id, pe.public_id, pe.name FROM people pe
      WHERE EXISTS (SELECT 1 FROM faces f WHERE f.person_id = pe.id AND f.status = 'confirmed')
      ORDER BY pe.name`,
  );
}

export async function getPerson(publicId: string): Promise<Person | null> {
  return queryOne<Person>("SELECT id, public_id, name, cover_face_id FROM people WHERE public_id = ?", [publicId]);
}

export async function facesSummary(): Promise<{ scanned: number; pending: number; unknown: number; groups: number; suggested: number }> {
  const row = await queryOne<{ scanned: number; pending: number; unknown: number; groups: number; suggested: number }>(
    `SELECT
       (SELECT COUNT(*) FROM photos WHERE deleted_at IS NULL AND faces_scanned_at IS NOT NULL) AS scanned,
       (SELECT COUNT(*) FROM photos WHERE deleted_at IS NULL AND gcs_preview_key IS NOT NULL AND faces_scanned_at IS NULL) AS pending,
       (SELECT COUNT(*) FROM faces WHERE status = 'unknown' AND cluster_id IS NOT NULL) AS unknown,
       (SELECT COUNT(DISTINCT cluster_id) FROM faces WHERE status = 'unknown' AND cluster_id IS NOT NULL) AS \`groups\`,
       (SELECT COUNT(*) FROM faces WHERE status = 'suggested') AS suggested`,
  );
  return row!;
}

export type Cluster = { cluster_id: number; size: number; faces: FaceTile[] };

/** Gruppi di volti senza nome, dal più grande, con i primi volti di ognuno. */
export async function listClusters(offset: number, limit: number, perCluster = 18): Promise<Cluster[]> {
  const groups = await query<{ cluster_id: number; size: number }>(
    `SELECT cluster_id, COUNT(*) AS size FROM faces
      WHERE status = 'unknown' AND cluster_id IS NOT NULL
      GROUP BY cluster_id ORDER BY size DESC, cluster_id LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  if (!groups.length) return [];
  const faces = await query<FaceTile & { cluster_id: number; rn: number }>(
    `SELECT * FROM (
       SELECT ${FACE_TILE}, f.cluster_id,
              ROW_NUMBER() OVER (PARTITION BY f.cluster_id ORDER BY f.det_score DESC, f.id) AS rn
         FROM faces f JOIN photos p ON p.id = f.photo_id AND p.deleted_at IS NULL
        WHERE f.status = 'unknown' AND f.cluster_id IN (?)
     ) t WHERE rn <= ?`,
    [groups.map((g) => g.cluster_id), perCluster],
  );
  return groups.map((g) => ({ ...g, faces: faces.filter((f) => f.cluster_id === g.cluster_id) }));
}

export async function countClusters(): Promise<number> {
  const row = await queryOne<{ n: number }>(
    "SELECT COUNT(DISTINCT cluster_id) AS n FROM faces WHERE status = 'unknown' AND cluster_id IS NOT NULL",
  );
  return row?.n ?? 0;
}

/** Suggerimenti raggruppati per persona, i più sicuri prima. */
export async function listSuggestions(limitPerPerson = 60): Promise<{ person: Person; total: number; faces: FaceTile[] }[]> {
  const people = await query<Person & { total: number }>(
    `SELECT pe.id, pe.public_id, pe.name, pe.cover_face_id, COUNT(*) AS total
       FROM faces f JOIN people pe ON pe.id = f.person_id
      WHERE f.status = 'suggested'
      GROUP BY pe.id ORDER BY pe.name`,
  );
  if (!people.length) return [];
  const faces = await query<FaceTile & { person_id: number; rn: number }>(
    `SELECT * FROM (
       SELECT ${FACE_TILE}, f.person_id,
              ROW_NUMBER() OVER (PARTITION BY f.person_id ORDER BY f.suggest_score DESC, f.id) AS rn
         FROM faces f JOIN photos p ON p.id = f.photo_id AND p.deleted_at IS NULL
        WHERE f.status = 'suggested'
     ) t WHERE rn <= ?`,
    [limitPerPerson],
  );
  return people.map(({ total, ...person }) => ({
    person,
    total,
    faces: faces.filter((f) => f.person_id === person.id),
  }));
}

/** Foto in cui la persona compare (volti confermati), per data. */
export async function personPhotos(personId: number, offset: number, limit: number): Promise<PhotoCard[]> {
  return query<PhotoCard>(
    `SELECT ${CARD_COLUMNS}
       FROM photos p
       ${LINKED_EXPORT}
      WHERE p.deleted_at IS NULL
        AND p.id IN (SELECT f.photo_id FROM faces f WHERE f.person_id = ? AND f.status = 'confirmed')
        -- un export collegato a un CR2 della stessa persona è la stessa foto: si mostra solo il CR2
        AND NOT (p.derived_from_id IS NOT NULL AND p.match_status IN ('auto', 'confirmed')
                 AND p.derived_from_id IN (SELECT f.photo_id FROM faces f WHERE f.person_id = ? AND f.status = 'confirmed'))
      ORDER BY p.taken_at IS NULL, p.taken_at, p.taken_at_subsec, p.id
      LIMIT ? OFFSET ?`,
    [personId, personId, limit, offset],
  );
}

export async function countPersonPhotos(personId: number): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM photos p
      WHERE p.deleted_at IS NULL
        AND p.id IN (SELECT f.photo_id FROM faces f WHERE f.person_id = ? AND f.status = 'confirmed')
        AND NOT (p.derived_from_id IS NOT NULL AND p.match_status IN ('auto', 'confirmed')
                 AND p.derived_from_id IN (SELECT f.photo_id FROM faces f WHERE f.person_id = ? AND f.status = 'confirmed'))`,
    [personId, personId],
  );
  return row?.n ?? 0;
}

/** Volti confermati della persona (per togliere quelli sbagliati). */
export async function personFaces(personId: number, limit = 120): Promise<FaceTile[]> {
  return query<FaceTile>(
    `SELECT ${FACE_TILE} FROM faces f JOIN photos p ON p.id = f.photo_id AND p.deleted_at IS NULL
      WHERE f.person_id = ? AND f.status = 'confirmed'
      ORDER BY f.confirmed_at DESC, f.id DESC LIMIT ?`,
    [personId, limit],
  );
}

/** Nomi delle persone confermate in una foto (pagina della foto). */
export async function peopleInPhoto(photoId: number): Promise<{ public_id: string; name: string }[]> {
  return query<{ public_id: string; name: string }>(
    `SELECT DISTINCT pe.public_id, pe.name FROM faces f JOIN people pe ON pe.id = f.person_id
      WHERE f.photo_id = ? AND f.status = 'confirmed' ORDER BY pe.name`,
    [photoId],
  );
}

// ---------------------------------------------------------------------
// Modifiche
// ---------------------------------------------------------------------

export const PERSON_NAME_MAX = 120;

/** Persona con questo nome (maiuscole e accenti non contano), creata se manca. */
export async function findOrCreatePerson(name: string): Promise<Person> {
  const existing = await queryOne<Person>("SELECT id, public_id, name, cover_face_id FROM people WHERE name = ?", [name]);
  if (existing) return existing;
  const publicId = randomBase62(22);
  const res = await execute("INSERT INTO people (public_id, name) VALUES (?, ?)", [publicId, name]);
  return { id: res.insertId, public_id: publicId, name, cover_face_id: null };
}

/**
 * Ricalcola il volto tipo dalle conferme e, se manca o non è più suo,
 * sceglie come foto profilo il volto confermato più nitido.
 */
export async function refreshPerson(personId: number): Promise<void> {
  const rows = await query<{ embedding: Buffer }>(
    "SELECT embedding FROM faces WHERE person_id = ? AND status = 'confirmed'",
    [personId],
  );
  const c = centroid(rows.map((r) => decodeEmbedding(r.embedding)));
  await execute(
    `UPDATE people pe SET centroid = ?,
            cover_face_id = IF(
              pe.cover_face_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM faces f WHERE f.id = pe.cover_face_id AND f.person_id = pe.id AND f.status = 'confirmed'),
              pe.cover_face_id,
              (SELECT f.id FROM faces f WHERE f.person_id = pe.id AND f.status = 'confirmed'
                ORDER BY f.det_score DESC, f.id LIMIT 1))
      WHERE pe.id = ?`,
    [c ? encodeEmbedding(c) : null, personId],
  );
}

/** Dà il nome a un gruppo, tranne i volti esclusi (che restano senza nome). */
export async function nameCluster(clusterId: number, personId: number, excludedFaceIds: number[]): Promise<number> {
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    if (excludedFaceIds.length) {
      await conn.query(
        "UPDATE faces SET cluster_id = NULL WHERE cluster_id = ? AND status = 'unknown' AND id IN (?)",
        [clusterId, excludedFaceIds],
      );
    }
    const [res] = await conn.query<import("mysql2").ResultSetHeader>(
      `UPDATE faces SET status = 'confirmed', person_id = ?, cluster_id = NULL, suggest_score = NULL,
              confirmed_at = UTC_TIMESTAMP()
        WHERE cluster_id = ? AND status = 'unknown'`,
      [personId, clusterId],
    );
    await conn.commit();
    return res.affectedRows;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** "Non mi interessa": i volti del gruppo non vengono più proposti. */
export async function ignoreCluster(clusterId: number): Promise<void> {
  await execute("UPDATE faces SET status = 'ignored', cluster_id = NULL WHERE cluster_id = ? AND status = 'unknown'", [
    clusterId,
  ]);
}

export async function confirmSuggestions(personId: number, faceIds: number[]): Promise<void> {
  if (!faceIds.length) return;
  await execute(
    `UPDATE faces SET status = 'confirmed', suggest_score = NULL, confirmed_at = UTC_TIMESTAMP()
      WHERE person_id = ? AND status = 'suggested' AND id IN (?)`,
    [personId, faceIds],
  );
}

/** "Non è lei/lui": il volto torna senza nome e non verrà più proposto per questa persona. */
export async function rejectFaces(personId: number, faceIds: number[], from: "suggested" | "confirmed"): Promise<void> {
  if (!faceIds.length) return;
  const ids = (
    await query<{ id: number }>("SELECT id FROM faces WHERE person_id = ? AND status = ? AND id IN (?)", [
      personId,
      from,
      faceIds,
    ])
  ).map((r) => r.id);
  if (!ids.length) return;
  await execute("INSERT IGNORE INTO face_rejections (face_id, person_id) VALUES ?", [ids.map((id) => [id, personId])]);
  await execute(
    `UPDATE faces SET status = 'unknown', person_id = NULL, suggest_score = NULL, confirmed_at = NULL, cluster_id = NULL
      WHERE id IN (?)`,
    [ids],
  );
}

export async function renamePerson(personId: number, name: string): Promise<{ error: string } | { ok: true }> {
  const clash = await queryOne<{ id: number }>("SELECT id FROM people WHERE name = ? AND id <> ?", [name, personId]);
  if (clash) return { error: "Esiste già una persona con questo nome: usa \"Unisci\" se sono la stessa." };
  await execute("UPDATE people SET name = ? WHERE id = ?", [name, personId]);
  return { ok: true };
}

/** Sposta volti e scarti di `fromId` su `intoId` ed elimina `fromId`. */
export async function mergePeople(fromId: number, intoId: number): Promise<void> {
  if (fromId === intoId) return;
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE people SET cover_face_id = NULL WHERE id = ?", [fromId]);
    await conn.query("UPDATE faces SET person_id = ? WHERE person_id = ?", [intoId, fromId]);
    await conn.query(
      "INSERT IGNORE INTO face_rejections (face_id, person_id, created_at) SELECT face_id, ?, created_at FROM face_rejections WHERE person_id = ?",
      [intoId, fromId],
    );
    await conn.query("DELETE FROM people WHERE id = ?", [fromId]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  await refreshPerson(intoId);
}

/**
 * Elimina la persona e i suoi volti (impronte comprese): sono dati
 * biometrici e non devono restare. Le foto restano; i volti non vengono
 * ritrovati finché non si rianalizza la foto con `--rifai`.
 */
export async function deletePerson(personId: number): Promise<void> {
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE people SET cover_face_id = NULL WHERE id = ?", [personId]);
    await conn.query("DELETE FROM faces WHERE person_id = ?", [personId]);
    await conn.query("DELETE FROM people WHERE id = ?", [personId]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
