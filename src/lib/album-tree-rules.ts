/*
 * Regole pure dei sotto-album (niente database), verificate dai test in
 * tests/album-tree-rules.test.ts.
 *
 * Livelli: 1 = album di primo livello, 2 = sotto-album, 3 = sotto-album di
 * un sotto-album. Più di così no (decisione di Antonio del 2026-11-09).
 */

export const MAX_ALBUM_DEPTH = 3;

/** Separatore dei titoli per le cartelle oltre il terzo livello, e del percorso mostrato. */
export const PATH_SEP = " › ";

export type TreeNode = { id: number; parent_id: number | null };

/** Livello dell'album (1 = primo livello). Si ferma sui cicli invece di girare all'infinito. */
export function depthOf(id: number, byId: Map<number, TreeNode>): number {
  let depth = 0;
  const seen = new Set<number>();
  for (let cur: TreeNode | undefined = byId.get(id); cur && !seen.has(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined) {
    seen.add(cur.id);
    depth++;
  }
  return depth;
}

/** Id dell'album e di tutti i suoi discendenti. */
export function subtreeOf(id: number, nodes: TreeNode[]): Set<number> {
  const children = new Map<number, number[]>();
  for (const n of nodes) {
    if (n.parent_id !== null) children.set(n.parent_id, [...(children.get(n.parent_id) ?? []), n.id]);
  }
  const out = new Set<number>([id]);
  const stack = [id];
  while (stack.length) {
    for (const c of children.get(stack.pop()!) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}

/** Quanti livelli occupa il ramo che parte dall'album (1 = nessun sotto-album). */
export function heightOf(id: number, nodes: TreeNode[]): number {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sub = subtreeOf(id, nodes);
  const base = depthOf(id, byId);
  let max = base;
  for (const s of sub) max = Math.max(max, depthOf(s, byId));
  return max - base + 1;
}

/**
 * Si può spostare l'album dentro `parentId` (null = primo livello)?
 * No dentro sé stesso o un suo discendente, e il ramo non deve superare
 * i 3 livelli. Restituisce il motivo se non si può.
 */
export function moveProblem(albumId: number, parentId: number | null, nodes: TreeNode[]): string | null {
  if (parentId === null) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(parentId)) return "L'album di destinazione non esiste più.";
  if (subtreeOf(albumId, nodes).has(parentId)) return "Non puoi spostare un album dentro sé stesso o un suo sotto-album.";
  if (depthOf(parentId, byId) + heightOf(albumId, nodes) > MAX_ALBUM_DEPTH) {
    return `Così si supererebbero i ${MAX_ALBUM_DEPTH} livelli di album.`;
  }
  return null;
}

/** Destinazioni possibili per "Sposta in…" (esclusa quella attuale). */
export function moveTargets(albumId: number, nodes: TreeNode[]): number[] {
  const current = nodes.find((n) => n.id === albumId)?.parent_id ?? null;
  return nodes.map((n) => n.id).filter((id) => id !== current && moveProblem(albumId, id, nodes) === null);
}

/**
 * Album di una cartella del disco, dato il percorso dalla cartella scelta
 * (es. ["Viaggi", "2019", "Roma"]): le cartelle che la contengono diventano
 * gli album sopra. Oltre il terzo livello le cartelle restano nel terzo,
 * con il resto del percorso nel titolo ("Roma › Giorno 1").
 * Restituisce gli indici di fine dei genitori (i percorsi sono segments.slice(0, n))
 * e il titolo.
 */
export function folderPlacement(segments: string[]): { parents: number[]; title: string } {
  if (segments.length <= MAX_ALBUM_DEPTH) {
    return { parents: segments.slice(0, -1).map((_, i) => i + 1), title: segments[segments.length - 1] ?? "" };
  }
  const keep = MAX_ALBUM_DEPTH - 1;
  return {
    parents: Array.from({ length: keep }, (_, i) => i + 1),
    title: segments.slice(keep).join(PATH_SEP),
  };
}

/**
 * Unione di album: i sotto-album degli album uniti passano dentro quello
 * tenuto. Non si può unire un album con uno che lo contiene (sparirebbe
 * insieme al suo contenitore), e il risultato non deve superare i 3 livelli.
 */
export function mergeTreeProblem(intoId: number, sourceIds: number[], nodes: TreeNode[]): string | null {
  const sources = new Set(sourceIds);
  for (const s of sourceIds) {
    if (subtreeOf(s, nodes).has(intoId)) return "Non puoi unire un album dentro un suo sotto-album.";
  }
  const after = nodes
    .filter((n) => !sources.has(n.id))
    .map((n) => (n.parent_id !== null && sources.has(n.parent_id) ? { ...n, parent_id: intoId } : n));
  const byId = new Map(after.map((n) => [n.id, n]));
  for (const id of subtreeOf(intoId, after)) {
    if (depthOf(id, byId) > MAX_ALBUM_DEPTH) {
      return `Unendo questi album i sotto-album supererebbero i ${MAX_ALBUM_DEPTH} livelli: spostali prima con «Sposta in…».`;
    }
  }
  return null;
}
