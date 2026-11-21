import { describe, expect, it } from "vitest";
import { albumPreviewDescription, clip, isPreviewBot } from "../src/lib/link-preview-rules";

describe("clip", () => {
  it("lascia com'è un testo corto e unisce gli spazi", () => {
    expect(clip("  Ciao\n\na tutti  ")).toBe("Ciao a tutti");
  });
  it("taglia su una parola con i puntini", () => {
    const out = clip("uno due tre quattro cinque", 15);
    expect(out).toBe("uno due tre…");
    expect(out.length).toBeLessThanOrEqual(15);
  });
});

describe("albumPreviewDescription", () => {
  it("preferisce il messaggio della condivisione", () => {
    expect(albumPreviewDescription({ message: "Le foto della festa", description: "x", dates: "1 gen 2024", photos: 3 })).toBe(
      "Le foto della festa",
    );
  });
  it("poi la descrizione dell'album", () => {
    expect(albumPreviewDescription({ message: " ", description: "Estate", dates: "", photos: 3 })).toBe("Estate");
  });
  it("altrimenti date e numero di foto", () => {
    expect(albumPreviewDescription({ message: null, description: null, dates: "1 – 5 ago 2023", photos: 12345 })).toBe(
      "1 – 5 ago 2023 · 12.345 foto",
    );
    expect(albumPreviewDescription({ message: null, description: null, dates: "", photos: 1 })).toBe("1 foto");
  });
});

describe("isPreviewBot", () => {
  it("riconosce i programmi delle anteprime", () => {
    expect(isPreviewBot("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)")).toBe(true);
    expect(isPreviewBot("WhatsApp/2.23.20.0 A")).toBe(true);
    expect(isPreviewBot("TelegramBot (like TwitterBot)")).toBe(true);
  });
  it("non scambia un browser per un bot", () => {
    expect(isPreviewBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1")).toBe(
      false,
    );
    expect(isPreviewBot(null)).toBe(false);
  });
});
