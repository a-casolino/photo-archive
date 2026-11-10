import { describe, expect, it } from "vitest";
import {
  depthOf,
  folderPlacement,
  heightOf,
  mergeTreeProblem,
  moveProblem,
  moveTargets,
  subtreeOf,
  type TreeNode,
} from "../src/lib/album-tree-rules";

// Viaggi(1) › 2019(2) › Roma(3); Mare(4) al primo livello; Sardegna(5) dentro Mare.
const nodes: TreeNode[] = [
  { id: 1, parent_id: null },
  { id: 2, parent_id: 1 },
  { id: 3, parent_id: 2 },
  { id: 4, parent_id: null },
  { id: 5, parent_id: 4 },
];
const byId = new Map(nodes.map((n) => [n.id, n]));

describe("albero degli album", () => {
  it("calcola livello, ramo e altezza", () => {
    expect(depthOf(1, byId)).toBe(1);
    expect(depthOf(3, byId)).toBe(3);
    expect([...subtreeOf(1, nodes)].sort()).toEqual([1, 2, 3]);
    expect(heightOf(1, nodes)).toBe(3);
    expect(heightOf(4, nodes)).toBe(2);
    expect(heightOf(3, nodes)).toBe(1);
  });

  it("non gira all'infinito su un ciclo", () => {
    const loop = new Map<number, TreeNode>([
      [1, { id: 1, parent_id: 2 }],
      [2, { id: 2, parent_id: 1 }],
    ]);
    expect(depthOf(1, loop)).toBe(2);
  });
});

describe("Sposta in…", () => {
  it("vieta di spostare un album dentro sé stesso o un suo sotto-album", () => {
    expect(moveProblem(1, 1, nodes)).toMatch(/sé stesso/);
    expect(moveProblem(1, 3, nodes)).toMatch(/sé stesso/);
  });

  it("non supera i 3 livelli", () => {
    // Mare (2 livelli) dentro 2019 (livello 2) → 4 livelli.
    expect(moveProblem(4, 2, nodes)).toMatch(/3 livelli/);
    // Mare dentro Viaggi → Viaggi › Mare › Sardegna: ok.
    expect(moveProblem(4, 1, nodes)).toBeNull();
    // Primo livello: sempre possibile.
    expect(moveProblem(3, null, nodes)).toBeNull();
  });

  it("elenca solo le destinazioni possibili, esclusa quella attuale", () => {
    expect(moveTargets(5, nodes).sort()).toEqual([1, 2]); // non 3 (livello 4), non 4 (è già lì)
    expect(moveTargets(4, nodes)).toEqual([1]);
  });
});

describe("unione di album", () => {
  it("vieta di unire un album dentro un suo sotto-album", () => {
    expect(mergeTreeProblem(3, [1], nodes)).toMatch(/sotto-album/);
  });

  it("controlla i livelli dopo che i sotto-album passano all'album tenuto", () => {
    // Mare (con Sardegna) unito in 2019: Sardegna finirebbe al livello 3, ok.
    expect(mergeTreeProblem(2, [4], nodes)).toBeNull();
    // Mare unito in Roma: Sardegna al livello 4.
    expect(mergeTreeProblem(3, [4], nodes)).toMatch(/3 livelli/);
  });
});

describe("cartelle e livelli", () => {
  it("fino a 3 livelli ogni cartella è un album", () => {
    expect(folderPlacement(["Viaggi"])).toEqual({ parents: [], title: "Viaggi" });
    expect(folderPlacement(["Viaggi", "2019", "Roma"])).toEqual({ parents: [1, 2], title: "Roma" });
  });

  it("oltre, il resto del percorso va nel titolo del terzo livello", () => {
    expect(folderPlacement(["Viaggi", "2019", "Roma", "Giorno 1", "Mattina"])).toEqual({
      parents: [1, 2],
      title: "Roma › Giorno 1 › Mattina",
    });
  });

  it("dentro un album che ha già livelli sopra, se ne usano meno", () => {
    expect(folderPlacement(["Roma", "Giorno 1", "Mattina"], 2)).toEqual({ parents: [1], title: "Giorno 1 › Mattina" });
    expect(folderPlacement(["Roma", "Giorno 1"], 1)).toEqual({ parents: [], title: "Roma › Giorno 1" });
    expect(folderPlacement(["Roma"], 1)).toEqual({ parents: [], title: "Roma" });
  });
});
