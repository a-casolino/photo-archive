import { describe, expect, it } from "vitest";
import { GRID_BATCH, GRID_MAX, GRID_RESTORE_MAX_AGE_MS, parseBatch, restoreCount } from "../src/lib/grid-rules";

describe("parseBatch", () => {
  it("usa i valori di default", () => {
    expect(parseBatch(null, null)).toEqual({ offset: 0, limit: GRID_BATCH });
  });
  it("scarta valori negativi o strani", () => {
    expect(parseBatch("-5", "abc")).toEqual({ offset: 0, limit: GRID_BATCH });
    expect(parseBatch("12.7", "0")).toEqual({ offset: 12, limit: GRID_BATCH });
  });
  it("limita n", () => {
    expect(parseBatch("60", "100000").limit).toBe(GRID_MAX);
    expect(parseBatch("60", "5").limit).toBe(5);
  });
});

describe("restoreCount", () => {
  const now = 1_000_000_000;
  it("carica quanto manca per tornare alla posizione", () => {
    expect(restoreCount({ count: 200, y: 900, at: now - 1000 }, 60, 500, now)).toBe(140);
  });
  it("non supera il totale né GRID_MAX", () => {
    expect(restoreCount({ count: 200, y: 0, at: now }, 60, 100, now)).toBe(40);
    expect(restoreCount({ count: 5000, y: 0, at: now }, 60, 9000, now)).toBe(GRID_MAX);
  });
  it("ignora posizioni vecchie, nel futuro o non valide", () => {
    expect(restoreCount({ count: 200, y: 0, at: now - GRID_RESTORE_MAX_AGE_MS - 1 }, 60, 500, now)).toBe(0);
    expect(restoreCount({ count: 200, y: 0, at: now + 10 }, 60, 500, now)).toBe(0);
    expect(restoreCount(null, 60, 500, now)).toBe(0);
    expect(restoreCount({ count: "x" }, 60, 500, now)).toBe(0);
    expect(restoreCount({ count: 30, y: 0, at: now }, 60, 500, now)).toBe(0);
  });
});
