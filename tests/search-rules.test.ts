import { describe, expect, it } from "vitest";
import { escapeLike, highlightParts, parseSearchQuery, SEARCH_MAX_LENGTH } from "../src/lib/search-rules";

describe("ricerca con suggerimenti", () => {
  it("ripulisce il testo cercato", () => {
    expect(parseSearchQuery("  lago   di  Garda ")).toBe("lago di Garda");
    expect(parseSearchQuery(undefined)).toBe("");
    expect(parseSearchQuery(["x"])).toBe("");
    expect(parseSearchQuery("x".repeat(500))).toHaveLength(SEARCH_MAX_LENGTH);
  });

  it("protegge i caratteri speciali del LIKE", () => {
    expect(escapeLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
  });

  it("evidenzia senza badare a maiuscole e accenti", () => {
    expect(highlightParts("Vacanze in Città", "citta")).toEqual([
      { text: "Vacanze in ", match: false },
      { text: "Città", match: true },
    ]);
    expect(highlightParts("Natale 2014", "NAT")).toEqual([
      { text: "Nat", match: true },
      { text: "ale 2014", match: false },
    ]);
    // Come l'ordine dei suggerimenti: meglio l'inizio di una parola.
    expect(highlightParts("Lago di Garda", "g")).toEqual([
      { text: "Lago di ", match: false },
      { text: "G", match: true },
      { text: "arda", match: false },
    ]);
    expect(highlightParts("Garda", "mare")).toEqual([{ text: "Garda", match: false }]);
    expect(highlightParts("Garda", " ")).toEqual([{ text: "Garda", match: false }]);
  });
});
