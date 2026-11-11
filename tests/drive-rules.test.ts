import { describe, expect, it } from "vitest";
import { groupTakeoutExports, makeBatches, safeSegment, uniqueName, zipEntrySegments } from "../src/lib/drive-rules";

describe("groupTakeoutExports", () => {
  it("raggruppa gli zip dello stesso export, in ordine, più recente prima", () => {
    const groups = groupTakeoutExports([
      { id: "c", name: "takeout-20261109T083015Z-010.zip", size: 5 },
      { id: "a", name: "takeout-20261109T083015Z-001.zip", size: 10 },
      { id: "b", name: "takeout-20261109T083015Z-002.zip", size: 20 },
      { id: "x", name: "takeout-20250101T000000Z-001.tgz", size: 1 },
      { id: "z", name: "vacanze.zip", size: 1 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].key).toBe("takeout-20261109t083015z");
    expect(groups[0].parts.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(groups[0].bytes).toBe(35);
    expect(groups[0].tgz).toBe(false);
    expect(groups[0].createdAt.toISOString()).toBe("2026-11-09T08:30:15.000Z");
    expect(groups[1].tgz).toBe(true);
  });

  it("accetta anche i nomi con un numero in più (export ripetuti)", () => {
    const groups = groupTakeoutExports([{ id: "a", name: "takeout-20261109T083015Z-3-001.zip", size: 1 }]);
    expect(groups[0].key).toBe("takeout-20261109t083015z");
  });

  it("unisce le parti dello stesso export con orari diversi di qualche secondo", () => {
    const groups = groupTakeoutExports([
      { id: "b", name: "takeout-20261109T205103Z-1-001.zip", size: 4 },
      { id: "c", name: "takeout-20261109T205103Z-1-002.zip", size: 4 },
      { id: "a", name: "takeout-20261109T205102Z-001.zip", size: 1 },
      { id: "x", name: "takeout-20261109T213000Z-001.zip", size: 2 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[1].key).toBe("takeout-20261109t205102z");
    expect(groups[1].parts.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(groups[1].bytes).toBe(9);
    expect(groups[0].parts.map((p) => p.id)).toEqual(["x"]);
  });
});

describe("nomi sicuri", () => {
  it("toglie le barre e i punti iniziali", () => {
    expect(safeSegment("Estate 2019/2020")).toBe("Estate 2019_2020");
    expect(safeSegment("..segreto")).toBe("_segreto");
    expect(safeSegment("   ")).toBe("_");
  });

  it("accorcia i nomi troppo lunghi tenendo l'estensione", () => {
    const out = safeSegment("a".repeat(300) + ".jpg");
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(200);
    expect(out.endsWith(".jpg")).toBe(true);
  });

  it("rende unici i nomi uguali nella stessa cartella", () => {
    const taken = new Set<string>();
    expect(uniqueName("IMG_1.JPG", taken)).toBe("IMG_1.JPG");
    expect(uniqueName("img_1.jpg", taken)).toBe("img_1 (2).jpg");
    expect(uniqueName("IMG_1.JPG", taken)).toBe("IMG_1 (3).JPG");
  });

  it("rifiuta le voci di zip pericolose", () => {
    expect(zipEntrySegments("Takeout/Google Foto/Album/a.jpg")).toEqual(["Takeout", "Google Foto", "Album", "a.jpg"]);
    expect(zipEntrySegments("Takeout/Google Foto/")).toBeNull();
    expect(zipEntrySegments("../etc/passwd")).toBeNull();
    expect(zipEntrySegments("/etc/passwd")).toBeNull();
  });
});

describe("makeBatches", () => {
  it("rispetta il limite e mette da soli i file più grandi", () => {
    const items = [3, 3, 3, 10, 1, 1].map((size, i) => ({ i, size }));
    expect(makeBatches(items, 6).map((b) => b.map((x) => x.i))).toEqual([[0, 1], [2], [3], [4, 5]]);
    expect(makeBatches([], 6)).toEqual([]);
  });
});
