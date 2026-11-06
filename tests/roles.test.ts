import { describe, expect, it } from "vitest";
import { canDownload, effectiveDownload } from "../src/lib/roles";

describe("permesso di download effettivo", () => {
  it("il proprietario scarica sempre l'originale", () => {
    expect(effectiveDownload("none", "owner")).toBe("original");
  });

  it("il fidato riceve quanto concede la condivisione", () => {
    expect(effectiveDownload("original", "trusted")).toBe("original");
    expect(effectiveDownload("preview", "trusted")).toBe("preview");
    expect(effectiveDownload("none", "trusted")).toBe("none");
  });

  it("il visualizzatore arriva al massimo al JPEG", () => {
    expect(effectiveDownload("original", "viewer")).toBe("preview");
    expect(effectiveDownload("preview", "viewer")).toBe("preview");
    expect(effectiveDownload("none", "viewer")).toBe("none");
  });

  it("i link liberi non danno mai l'originale", () => {
    expect(effectiveDownload("original", null)).toBe("preview");
    expect(canDownload(effectiveDownload("original", null), "original")).toBe(false);
  });
});
