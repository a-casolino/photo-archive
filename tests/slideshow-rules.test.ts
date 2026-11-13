import { describe, expect, it } from "vitest";
import {
  batchesFor,
  batchFresh,
  batchOf,
  castSupported,
  DEFAULT_INTERVAL,
  parseInterval,
  SLIDE_BATCH_MAX_AGE_MS,
  stepIndex,
} from "../src/lib/slideshow-rules";

describe("parseInterval", () => {
  it("accetta solo gli intervalli proposti", () => {
    expect(parseInterval("8")).toBe(8);
    expect(parseInterval(30)).toBe(30);
    expect(parseInterval("7")).toBe(DEFAULT_INTERVAL);
    expect(parseInterval(null)).toBe(DEFAULT_INTERVAL);
  });
});

describe("stepIndex", () => {
  it("va avanti e a fine album ricomincia", () => {
    expect(stepIndex(0, 1, 10, 10)).toBe(1);
    expect(stepIndex(9, 1, 10, 10)).toBe(0);
  });
  it("dalla prima torna all'ultima solo se l'elenco è tutto caricato", () => {
    expect(stepIndex(0, -1, 10, 10)).toBe(9);
    expect(stepIndex(0, -1, 300, 100)).toBe(0);
    expect(stepIndex(5, -1, 300, 100)).toBe(4);
  });
  it("album vuoto", () => {
    expect(stepIndex(0, 1, 0, 0)).toBe(0);
  });
});

describe("blocchi", () => {
  it("trova il blocco della foto", () => {
    expect(batchOf(0, 100)).toBe(0);
    expect(batchOf(99, 100)).toBe(0);
    expect(batchOf(100, 100)).toBe(100);
  });
  it("prepara il blocco successivo verso la fine di quello attuale", () => {
    expect(batchesFor(50, 300, 100)).toEqual([0]);
    expect(batchesFor(95, 300, 100)).toEqual([0, 100]);
    expect(batchesFor(95, 100, 100)).toEqual([0]);
  });
  it("a fine album prepara il primo blocco", () => {
    expect(batchesFor(295, 300, 100)).toEqual([200, 0]);
  });
  it("gli URL scadono dopo 90 minuti", () => {
    expect(batchFresh(0, SLIDE_BATCH_MAX_AGE_MS - 1)).toBe(true);
    expect(batchFresh(0, SLIDE_BATCH_MAX_AGE_MS)).toBe(false);
  });
});

describe("castSupported", () => {
  it("Chrome su computer e Android sì", () => {
    expect(
      castSupported("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36"),
    ).toBe(true);
    expect(
      castSupported("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Mobile Safari/537.36"),
    ).toBe(true);
  });
  it("iPhone, iPad, Safari e Firefox no", () => {
    expect(
      castSupported("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0 Mobile/15E148 Safari/604.1"),
    ).toBe(false);
    expect(
      castSupported("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", 5),
    ).toBe(false);
    expect(
      castSupported("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"),
    ).toBe(false);
    expect(castSupported("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe(false);
  });
});
