import { execute, query } from "../../src/lib/db";
import { bestPerson, centroid, leaderCluster, rankClusters } from "../../src/lib/faces/cluster";
import { FACE_MODEL_ID } from "../../src/lib/faces/constants";
import { decodeEmbedding, encodeEmbedding } from "../../src/lib/faces/embedding";

/*
 * Dopo l'analisi: aggiorna il volto tipo di ogni persona dalle sue
 * conferme, propone una persona per i volti che le somigliano e
 * raggruppa gli altri per la pagina "Da riconoscere".
 * Non tocca mai i volti confermati o ignorati.
 */

interface EmbRow {
  id: number;
  person_id: number | null;
  embedding: Buffer;
}

/** UPDATE a blocchi con CASE, per non fare una query per volto. */
async function updateColumn(column: "cluster_id", values: Map<number, number>) {
  const entries = [...values.entries()];
  for (let i = 0; i < entries.length; i += 1000) {
    const chunk = entries.slice(i, i + 1000);
    const cases = chunk.map(() => "WHEN ? THEN ?").join(" ");
    await execute(
      `UPDATE faces SET ${column} = CASE id ${cases} END WHERE id IN (?)`,
      [...chunk.flat(), chunk.map(([id]) => id)],
    );
  }
}

export async function groupFaces(): Promise<void> {
  const t0 = performance.now();

  // 1. Volto tipo di ogni persona.
  const confirmed = await query<EmbRow>(
    "SELECT id, person_id, embedding FROM faces WHERE status = 'confirmed' AND model = ?",
    [FACE_MODEL_ID],
  );
  const byPerson = new Map<number, Float32Array[]>();
  for (const r of confirmed) {
    const list = byPerson.get(r.person_id!) ?? [];
    list.push(decodeEmbedding(r.embedding));
    byPerson.set(r.person_id!, list);
  }
  const people: { id: number; centroid: Float32Array }[] = [];
  for (const [id, vectors] of byPerson) {
    const c = centroid(vectors)!;
    people.push({ id, centroid: c });
    await execute("UPDATE people SET centroid = ? WHERE id = ?", [encodeEmbedding(c), id]);
  }

  // 2. Scarti: "questo volto non è quella persona".
  const rejections = new Map<number, Set<number>>();
  for (const r of await query<{ face_id: number; person_id: number }>("SELECT face_id, person_id FROM face_rejections")) {
    const set = rejections.get(r.face_id) ?? new Set();
    set.add(r.person_id);
    rejections.set(r.face_id, set);
  }

  // 3. Volti ancora da decidere: suggerimento o gruppo.
  const pending = await query<EmbRow>(
    `SELECT id, person_id, embedding FROM faces
      WHERE status IN ('unknown', 'suggested') AND model = ?
      ORDER BY det_score DESC, id`,
    [FACE_MODEL_ID],
  );
  await execute(
    `UPDATE faces SET status = 'unknown', person_id = NULL, suggest_score = NULL, cluster_id = NULL
      WHERE status IN ('unknown', 'suggested')`,
  );

  let suggested = 0;
  const loose: { id: number; v: Float32Array }[] = [];
  for (const r of pending) {
    const v = decodeEmbedding(r.embedding);
    const match = bestPerson(v, people, rejections.get(r.id));
    if (match) {
      suggested++;
      await execute("UPDATE faces SET status = 'suggested', person_id = ?, suggest_score = ? WHERE id = ?", [
        match.id,
        match.score,
        r.id,
      ]);
    } else {
      loose.push({ id: r.id, v });
    }
  }

  const assignment = leaderCluster(loose.map((f) => f.v));
  const rank = rankClusters(assignment);
  await updateColumn("cluster_id", new Map(loose.map((f, i) => [f.id, rank.get(assignment[i])!])));

  const groups = rank.size;
  const ms = Math.round(performance.now() - t0);
  console.log(
    `Raggruppamento: ${people.length} persone, ${suggested} suggerimenti, ${loose.length} volti senza nome in ${groups} gruppi (${ms} ms).`,
  );
}
