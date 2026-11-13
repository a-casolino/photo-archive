import { describe, expect, it } from "vitest";
import { etichettaVersione, ultimaPr } from "../src/lib/versione";

describe("ultimaPr", () => {
  it("prende il merge commit più recente", () => {
    expect(
      ultimaPr([
        "Merge pull request #62 from a-casolino/claude/x",
        "feat: ricevitore Chromecast",
        "Merge pull request #61 from a-casolino/claude/x",
      ]),
    ).toBe(62);
  });
  it("salta i commit normali e riconosce lo squash", () => {
    expect(ultimaPr(["fix: cosa", "feat: footer (#63)", "Merge pull request #62 from x"])).toBe(63);
  });
  it("non confonde un # nel testo", () => {
    expect(ultimaPr(["fix: issue #5 nel mezzo del testo"])).toBeNull();
  });
});

describe("etichettaVersione", () => {
  it("scrive 0.PR", () => {
    expect(etichettaVersione(62)).toBe("v0.62");
    expect(etichettaVersione(null)).toBeNull();
  });
});
