import { describe, expect, it } from "vitest";
import { forget, forgetAll, forgetTags, isFresh, memo, memoSummary } from "../src/lib/memo";

describe("memo", () => {
  it("riusa il valore finché non scade", async () => {
    let n = 0;
    const load = async () => ++n;
    expect(await memo("t1", 1000, load, 0)).toBe(1);
    expect(await memo("t1", 1000, load, 500)).toBe(1);
    expect(await memo("t1", 1000, load, 1500)).toBe(2);
  });
  it("forget svuota la voce", async () => {
    let n = 0;
    const load = async () => ++n;
    await memo("t2", 1000, load, 0);
    forget("t2");
    expect(await memo("t2", 1000, load, 1)).toBe(2);
  });
  it("non tiene in cache gli errori", async () => {
    let n = 0;
    const load = async () => {
      n++;
      if (n === 1) throw new Error("no");
      return n;
    };
    await expect(memo("t3", 1000, load, 0)).rejects.toThrow("no");
    await new Promise((r) => setTimeout(r, 0));
    expect(await memo("t3", 1000, load, 1)).toBe(2);
  });
});

describe("memo con etichette", () => {
  it("forgetTags svuota solo le voci con quelle etichette", async () => {
    let n = 0;
    const load = async () => ++n;
    await memo("e1", 1000, load, 0, ["album"]);
    await memo("e2", 1000, load, 0, ["volti"]);
    await memo("e3", 1000, load, 0, ["album", "volti"]);
    expect(forgetTags(["album"])).toBe(2);
    expect(isFresh("e1", 1000, 1)).toBe(false);
    expect(isFresh("e2", 1000, 1)).toBe(true);
    expect(isFresh("e3", 1000, 1)).toBe(false);
    forgetAll();
  });
  it("una voce svuotata mentre carica non torna in cache", async () => {
    let release!: (v: number) => void;
    const slow = memo("e4", 1000, () => new Promise<number>((r) => (release = r)), 0, ["album"]);
    forgetTags(["album"]);
    release(1);
    expect(await slow).toBe(1);
    expect(isFresh("e4", 1000, 1)).toBe(false);
  });
  it("memoSummary conta le voci per etichetta con la più vecchia", async () => {
    forgetAll();
    await memo("s1", 1000, async () => 1, 10, ["album"]);
    await memo("s2", 1000, async () => 1, 20, ["album"]);
    await memo("s3", 1000, async () => 1, 30);
    expect(memoSummary()).toEqual([
      { tag: "album", entries: 2, oldestAt: 10 },
      { tag: "altro", entries: 1, oldestAt: 30 },
    ]);
    forgetAll();
  });
});
