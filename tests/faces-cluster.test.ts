import { describe, expect, it } from "vitest";
import { bestPerson, centroid, leaderCluster, rankClusters } from "../src/lib/faces/cluster";
import { normalize, similarity } from "../src/lib/faces/embedding";

// Vettori 3D: "persone" lungo assi diversi, con un po' di rumore.
const v = (...xs: number[]) => normalize(Float32Array.from(xs));

describe("centroid", () => {
  it("media normalizzata", () => {
    const c = centroid([v(1, 0, 0), v(0, 1, 0)])!;
    expect(c[0]).toBeCloseTo(Math.SQRT1_2);
    expect(c[1]).toBeCloseTo(Math.SQRT1_2);
    expect(centroid([])).toBeNull();
  });
});

describe("leaderCluster", () => {
  it("separa due persone e tiene insieme i volti simili", () => {
    const faces = [v(1, 0.1, 0), v(0, 1, 0.1), v(1, 0, 0.1), v(0.1, 1, 0), v(0, 0, 1)];
    const a = leaderCluster(faces, 0.8);
    expect(a[0]).toBe(a[2]);
    expect(a[1]).toBe(a[3]);
    expect(new Set([a[0], a[1], a[4]]).size).toBe(3);
  });
  it("aggiorna il volto tipo del gruppo", () => {
    // il terzo somiglia alla media dei primi due più che al primo da solo
    const a = leaderCluster([v(1, 0, 0), v(0.8, 0.6, 0), v(0.6, 0.8, 0)], 0.75);
    expect(similarity(v(1, 0, 0), v(0.6, 0.8, 0))).toBeLessThan(0.75);
    expect(a).toEqual([0, 0, 0]);
  });
});

describe("bestPerson", () => {
  const people = [
    { id: 1, centroid: v(1, 0, 0) },
    { id: 2, centroid: v(0, 1, 0) },
  ];
  it("sceglie la più somigliante sopra soglia", () => {
    expect(bestPerson(v(0.9, 0.2, 0), people, new Set(), 0.5)?.id).toBe(1);
    expect(bestPerson(v(0, 0, 1), people, new Set(), 0.5)).toBeNull();
  });
  it("salta le persone già scartate per quel volto", () => {
    expect(bestPerson(v(0.9, 0.2, 0), people, new Set([1]), 0.1)?.id).toBe(2);
  });
});

describe("rankClusters", () => {
  it("numera i gruppi dal più grande", () => {
    const r = rankClusters([0, 1, 1, 2, 1, 2]);
    expect(r.get(1)).toBe(1);
    expect(r.get(2)).toBe(2);
    expect(r.get(0)).toBe(3);
  });
});
