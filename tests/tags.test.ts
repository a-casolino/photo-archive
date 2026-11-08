import { describe, expect, it } from "vitest";
import { parseTagInput, tagSlug } from "../src/lib/gallery-rules";

describe("tag", () => {
  it("slug minuscolo, senza accenti e con trattini", () => {
    expect(tagSlug("Lago di Garda")).toBe("lago-di-garda");
    expect(tagSlug("  Città  ")).toBe("citta");
    expect(tagSlug("Natale 2014!")).toBe("natale-2014");
    expect(tagSlug("—")).toBe("");
  });

  it("legge più tag separati da virgola o punto e virgola, senza doppioni", () => {
    expect(parseTagInput("montagna, Famiglia; #mare,, montagna , MONTAGNA")).toEqual(["montagna", "Famiglia", "mare"]);
  });

  it("ignora i tag vuoti e accorcia quelli troppo lunghi", () => {
    expect(parseTagInput(" , ; ")).toEqual([]);
    expect(parseTagInput("x".repeat(100))[0]).toHaveLength(64);
  });
});
