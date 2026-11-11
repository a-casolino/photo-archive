import { describe, expect, it } from "vitest";
import {
  GIB,
  monthlyCost,
  normalizeClass,
  operationClass,
  PRICES,
  projectStorage,
  sumSeries,
  totalUsd,
} from "../src/lib/cost-rules";

describe("operationClass", () => {
  it("riconosce scritture, letture e cancellazioni", () => {
    expect(operationClass("WriteObject")).toBe("A");
    expect(operationClass("ListObjects")).toBe("A");
    expect(operationClass("ComposeObject")).toBe("A");
    expect(operationClass("ReadObject")).toBe("B");
    expect(operationClass("GetObjectMetadata")).toBe("B");
    expect(operationClass("DeleteObject")).toBe("free");
  });
});

describe("normalizeClass", () => {
  it("porta i vecchi nomi a Standard", () => {
    expect(normalizeClass("ARCHIVE")).toBe("ARCHIVE");
    expect(normalizeClass("archive")).toBe("ARCHIVE");
    expect(normalizeClass("REGIONAL")).toBe("STANDARD");
    expect(normalizeClass(undefined)).toBe("STANDARD");
  });
});

describe("monthlyCost", () => {
  it("somma spazio, traffico e operazioni", () => {
    const lines = monthlyCost({
      storedBytes: { ARCHIVE: 100 * GIB, STANDARD: 10 * GIB },
      egressBytes: 5 * GIB,
      opsA: 2000,
      opsB: 100_000,
      archiveWrites: 1000,
      archiveReadBytes: 2 * GIB,
    });
    const by = Object.fromEntries(lines.map((l) => [l.key, l.usd]));
    expect(by["storage-ARCHIVE"]).toBeCloseTo(100 * PRICES.storage.ARCHIVE);
    expect(by["storage-STANDARD"]).toBeCloseTo(10 * PRICES.storage.STANDARD);
    expect(by.egress).toBeCloseTo(5 * PRICES.egress);
    // 1000 scritture Archive + 1000 altre di classe A + 100k letture
    expect(by.ops).toBeCloseTo(PRICES.opsA.ARCHIVE + PRICES.opsA.STANDARD + 100 * PRICES.opsB.STANDARD);
    expect(by.retrieval).toBeCloseTo(2 * PRICES.retrieval.ARCHIVE);
    expect(totalUsd(lines)).toBeCloseTo(Object.values(by).reduce((a, b) => a + b, 0));
  });

  it("segna come non misurato il traffico senza metriche", () => {
    const lines = monthlyCost({
      storedBytes: { ARCHIVE: GIB },
      egressBytes: null,
      opsA: null,
      opsB: null,
      archiveWrites: 0,
      archiveReadBytes: 0,
    });
    const egress = lines.find((l) => l.key === "egress");
    expect(egress?.known).toBe(false);
    expect(egress?.usd).toBe(0);
    expect(lines.find((l) => l.key === "ops")?.known).toBe(false);
  });
});

describe("projectStorage", () => {
  it("usa peso medio e proporzione delle anteprime di oggi", () => {
    const p = projectStorage(1e12, { originalBytes: 25e9, originalCount: 1000, standardBytes: 1e9 });
    expect(p.photos).toBe(40_000);
    expect(p.archiveBytes).toBe(1e12);
    expect(p.standardBytes).toBe(4e10);
  });

  it("senza dati usa i pesi stimati", () => {
    const p = projectStorage(1e12, { originalBytes: 0, originalCount: 0, standardBytes: 0 });
    expect(p.photos).toBe(40_000);
    expect(p.standardBytes).toBeGreaterThan(0);
  });
});

it("sumSeries", () => {
  expect(sumSeries([{ bytes: 1 }, { bytes: 2 }])).toBe(3);
});
