import "server-only";
import { query, queryOne } from "./db";

/*
 * Probabili doppioni tra i CR2: file diversi (SHA-256 diverso, altrimenti
 * l'import li avrebbe già saltati) che sembrano lo stesso scatto.
 *
 * Stessa fotocamera (marca, modello, numero di serie) e stesso istante, più:
 *  - stesso FileNumber Canon ("100-3681"), se entrambi lo hanno: distingue
 *    le foto di una raffica scattate nello stesso secondo;
 *  - altrimenti stesso nome file e stessi millisecondi.
 * Le coppie giudicate "foto diverse" stanno in duplicate_dismissals.
 */

const FILE_NUMBER = (alias: string) =>
  `NULLIF(JSON_UNQUOTE(JSON_EXTRACT(${alias}.exif_json, '$.FileNumber')), 'null')`;

export const DUPLICATE_PAIRS_FROM = `
  FROM photos a
  JOIN photos b
    ON b.camera_id = a.camera_id AND b.taken_at = a.taken_at AND b.id > a.id
   AND b.kind = 'raw' AND b.deleted_at IS NULL
 WHERE a.kind = 'raw' AND a.deleted_at IS NULL AND a.taken_at IS NOT NULL AND a.camera_id IS NOT NULL
   AND (
         (${FILE_NUMBER("a")} IS NOT NULL AND ${FILE_NUMBER("b")} IS NOT NULL
          AND ${FILE_NUMBER("a")} = ${FILE_NUMBER("b")})
      OR ((${FILE_NUMBER("a")} IS NULL OR ${FILE_NUMBER("b")} IS NULL)
          AND a.original_filename = b.original_filename
          AND a.taken_at_subsec <=> b.taken_at_subsec)
       )
   AND NOT EXISTS (SELECT 1 FROM duplicate_dismissals d WHERE d.photo_a = a.id AND d.photo_b = b.id)`;

export async function countDuplicatePairs(): Promise<number> {
  const row = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n ${DUPLICATE_PAIRS_FROM}`);
  return Number(row?.n ?? 0);
}

export type DuplicateSide = {
  id: number;
  pid: string;
  name: string;
  path: string | null;
  size: number;
  thumb: string | null;
  taken_at: Date | null;
  subsec: number | null;
  file_number: string | null;
  import_label: string | null;
  created_at: Date;
};

const SIDE = (p: "a" | "b") => `
  ${p}.id AS ${p}_id, ${p}.public_id AS ${p}_pid, ${p}.original_filename AS ${p}_name, ${p}.source_path AS ${p}_path,
  ${p}.file_size AS ${p}_size, ${p}.gcs_thumb_key AS ${p}_thumb, ${p}.taken_at AS ${p}_taken_at,
  ${p}.taken_at_subsec AS ${p}_subsec, ${FILE_NUMBER(p)} AS ${p}_file_number, ${p}.created_at AS ${p}_created_at,
  (SELECT i.label FROM imports i WHERE i.id = ${p}.import_id) AS ${p}_import_label`;

function side(p: "a" | "b", row: Record<string, unknown>): DuplicateSide {
  const get = <T>(k: string) => row[`${p}_${k}`] as T;
  return {
    id: Number(get("id")),
    pid: get("pid"),
    name: get("name"),
    path: get("path"),
    size: Number(get("size")),
    thumb: get("thumb"),
    taken_at: get("taken_at"),
    subsec: get("subsec"),
    file_number: get("file_number"),
    import_label: get("import_label"),
    created_at: get("created_at"),
  };
}

export async function listDuplicatePairs(limit = 30): Promise<{ a: DuplicateSide; b: DuplicateSide }[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT ${SIDE("a")}, ${SIDE("b")} ${DUPLICATE_PAIRS_FROM} ORDER BY a.taken_at, a.id, b.id LIMIT ${Number(limit)}`,
  );
  return rows.map((r) => ({ a: side("a", r), b: side("b", r) }));
}
