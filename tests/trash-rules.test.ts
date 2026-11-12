import { describe, expect, it } from "vitest";
import { decodeUndo, encodeUndo, purgeMessage, runLimited, storageKeysOf, topmostSelected } from "../src/lib/trash-rules";

describe("storageKeysOf", () => {
  it("prende originale, anteprima, miniatura e volti senza vuoti né doppioni", () => {
    const row = { id: 1, original_key: "originals/a.CR2", preview_key: "previews/a.jpg", thumb_key: null };
    expect(storageKeysOf(row, ["faces/a_0.jpg", "faces/a_0.jpg", ""])).toEqual([
      "originals/a.CR2",
      "previews/a.jpg",
      "faces/a_0.jpg",
    ]);
  });
});

describe("runLimited", () => {
  it("non supera il limite e raccoglie gli errori senza fermarsi", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    const failed = await runLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (n % 3 === 0) throw new Error(`no ${n}`);
      done.push(n);
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(done.sort()).toEqual([1, 2, 4, 5, 7]);
    expect(failed.map((f) => f.item).sort()).toEqual([3, 6]);
  });

  it("con un elenco vuoto non fa nulla", async () => {
    expect(await runLimited([], 4, async () => {})).toEqual([]);
  });
});

describe("purgeMessage", () => {
  it("singolare, plurale ed errori", () => {
    expect(purgeMessage(1, 0)).toBe("1 foto eliminata definitivamente.");
    expect(purgeMessage(3, 0)).toBe("3 foto eliminate definitivamente.");
    expect(purgeMessage(0, 2)).toContain("2 non eliminate");
  });
});

describe("annulla dopo il cestino", () => {
  const pid = "AbCdEfGhIjKlMnOpQrStUv";
  it("foto e album vanno e tornano dal cookie", () => {
    expect(decodeUndo(encodeUndo({ kind: "photos", ids: [3, 15, 3] }))).toEqual({ kind: "photos", ids: [3, 15] });
    expect(decodeUndo(encodeUndo({ kind: "albums", publicIds: [pid] }))).toEqual({ kind: "albums", publicIds: [pid] });
  });
  it("200 foto di una pagina ci stanno, troppe no", () => {
    const ids = Array.from({ length: 200 }, (_, i) => 1_000_000 + i);
    expect(encodeUndo({ kind: "photos", ids })).not.toBeNull();
    expect(encodeUndo({ kind: "photos", ids: Array.from({ length: 1000 }, (_, i) => 1_000_000 + i) })).toBeNull();
    expect(encodeUndo({ kind: "photos", ids: [] })).toBeNull();
  });
  it("scarta valori sporchi", () => {
    for (const v of [undefined, "", "f:", "f:1;DROP", "a:corto", "x:1", "f:0", "f:-1"]) expect(decodeUndo(v)).toBeNull();
  });
});

describe("topmostSelected", () => {
  it("toglie i sotto-album che se ne vanno già con il padre", () => {
    const parent = new Map<number, number | null>([
      [1, null],
      [2, 1],
      [3, 2],
      [4, null],
    ]);
    expect(topmostSelected([3, 1, 4], (id) => parent.get(id))).toEqual([1, 4]);
    expect(topmostSelected([2, 3], (id) => parent.get(id))).toEqual([2]);
  });
});
