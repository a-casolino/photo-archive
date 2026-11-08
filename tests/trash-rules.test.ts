import { describe, expect, it } from "vitest";
import { purgeMessage, runLimited, storageKeysOf } from "../src/lib/trash-rules";

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
