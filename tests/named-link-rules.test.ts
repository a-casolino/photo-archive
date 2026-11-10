import { describe, expect, it } from "vitest";
import { linkKeyKind, normalizeSlug, slugProblem } from "../src/lib/named-link-rules";

describe("nome dei link con nome", () => {
  it("normalizza spazi, maiuscole e accenti", () => {
    expect(normalizeSlug("Vizzarri")).toBe("vizzarri");
    expect(normalizeSlug("  Matrimonio Anna ")).toBe("matrimonio-anna");
    expect(normalizeSlug("Città_2026")).toBe("citta-2026");
    expect(normalizeSlug("a -- b")).toBe("a-b");
    expect(normalizeSlug("-ciao!-")).toBe("ciao");
  });

  it("accetta solo nomi di 2-30 caratteri validi", () => {
    expect(slugProblem("vizzarri")).toBeNull();
    expect(slugProblem("matrimonio-anna-2026")).toBeNull();
    expect(slugProblem("a")).not.toBeNull();
    expect(slugProblem("x".repeat(31))).not.toBeNull();
    expect(slugProblem("-ciao")).not.toBeNull();
    expect(slugProblem("ciao--mondo")).not.toBeNull();
    expect(slugProblem("Ciao")).not.toBeNull();
  });
});

describe("/l/<x>: token o nome", () => {
  it("32 caratteri base62 sono un token", () => {
    expect(linkKeyKind("aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY")).toBe("token");
  });

  it("un nome valido è un link con nome, anche scritto con le maiuscole", () => {
    expect(linkKeyKind("vizzarri")).toBe("slug");
    expect(linkKeyKind("Vizzarri")).toBe("slug");
  });

  it("il resto non è valido", () => {
    expect(linkKeyKind("x")).toBeNull();
    expect(linkKeyKind("ciao mondo")).toBeNull();
    expect(linkKeyKind("x".repeat(31))).toBeNull();
  });
});
