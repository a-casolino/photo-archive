import { normalize, similarity } from "./embedding";

/*
 * Raggruppamento dei volti senza nome e suggerimenti verso le persone
 * già nominate. Calcoli puri, senza database: li usa `npm run volti`.
 *
 * Soglie per ArcFace (buffalo_l), somiglianza coseno:
 *   - stessa persona di solito sopra 0,45, persone diverse sotto 0,25;
 *   - per raggruppare si sta più stretti (0,5): un gruppo sbagliato costa
 *     più di due gruppi della stessa persona, che si uniscono dando lo
 *     stesso nome.
 */

export const CLUSTER_THRESHOLD = 0.5;
export const SUGGEST_THRESHOLD = 0.45;

/** Media normalizzata: il "volto tipo" di una persona o di un gruppo. */
export function centroid(vectors: Float32Array[]): Float32Array | null {
  if (!vectors.length) return null;
  const sum = new Float32Array(vectors[0].length);
  for (const v of vectors) for (let i = 0; i < v.length; i++) sum[i] += v[i];
  return normalize(sum);
}

/**
 * Raggruppamento "a leader": ogni volto va nel gruppo il cui volto tipo
 * gli somiglia di più, se supera la soglia, altrimenti apre un gruppo
 * nuovo. Conviene passare prima i volti più nitidi (punteggio alto).
 * Restituisce per ogni volto l'indice del suo gruppo (0, 1, 2…).
 */
export function leaderCluster(vectors: Float32Array[], threshold = CLUSTER_THRESHOLD): number[] {
  const sums: Float32Array[] = [];
  const centers: Float32Array[] = [];
  return vectors.map((v) => {
    let best = -1;
    let bestSim = threshold;
    for (let c = 0; c < centers.length; c++) {
      const s = similarity(v, centers[c]);
      if (s >= bestSim) {
        bestSim = s;
        best = c;
      }
    }
    if (best < 0) {
      sums.push(Float32Array.from(v));
      centers.push(v);
      return centers.length - 1;
    }
    const sum = sums[best];
    for (let i = 0; i < v.length; i++) sum[i] += v[i];
    centers[best] = normalize(sum);
    return best;
  });
}

/**
 * Persona più somigliante sopra la soglia, saltando quelle per cui il
 * volto è già stato scartato ("non è lei").
 */
export function bestPerson(
  v: Float32Array,
  people: { id: number; centroid: Float32Array }[],
  rejected: ReadonlySet<number> = new Set(),
  threshold = SUGGEST_THRESHOLD,
): { id: number; score: number } | null {
  let best: { id: number; score: number } | null = null;
  for (const p of people) {
    if (rejected.has(p.id)) continue;
    const s = similarity(v, p.centroid);
    if (s >= threshold && (!best || s > best.score)) best = { id: p.id, score: s };
  }
  return best;
}

/** Ordina i gruppi dal più grande; restituisce la mappa vecchio indice -> numero 1..k. */
export function rankClusters(assignment: number[]): Map<number, number> {
  const sizes = new Map<number, number>();
  for (const c of assignment) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  const order = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return new Map(order.map(([c], i) => [c, i + 1]));
}
