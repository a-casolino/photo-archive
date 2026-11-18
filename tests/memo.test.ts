import { describe, expect, it } from "vitest";
import { forget, memo } from "../src/lib/memo";

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
