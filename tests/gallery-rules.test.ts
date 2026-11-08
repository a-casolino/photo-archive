import { describe, expect, it } from "vitest";
import {
  cameraLabel,
  columnsForWidth,
  displaySize,
  downloadName,
  exposureLabel,
  linkExpiry,
  masonryColumns,
  shareState,
} from "../src/lib/gallery-rules";

describe("stato delle condivisioni", () => {
  const now = new Date("2026-11-08T10:00:00Z");
  it("attiva senza scadenza o prima della scadenza", () => {
    expect(shareState({ revoked_at: null, expires_at: null }, now)).toBe("active");
    expect(shareState({ revoked_at: null, expires_at: new Date("2026-11-09T00:00:00Z") }, now)).toBe("active");
  });
  it("scaduta alla scadenza", () => {
    expect(shareState({ revoked_at: null, expires_at: now }, now)).toBe("expired");
  });
  it("la revoca vince sulla scadenza", () => {
    expect(shareState({ revoked_at: now, expires_at: new Date("2027-01-01") }, now)).toBe("revoked");
  });
  it("link liberi a 30 giorni", () => {
    expect(linkExpiry(30, now).toISOString()).toBe("2026-12-08T10:00:00.000Z");
  });
});

describe("proporzioni", () => {
  it("scambia i lati per le foto ruotate di 90°", () => {
    expect(displaySize(5184, 3456, 6)).toEqual({ width: 3456, height: 5184 });
    expect(displaySize(5184, 3456, 8)).toEqual({ width: 3456, height: 5184 });
    expect(displaySize(5184, 3456, 1)).toEqual({ width: 5184, height: 3456 });
    expect(displaySize(5184, 3456, null)).toEqual({ width: 5184, height: 3456 });
  });
  it("null se le dimensioni mancano", () => {
    expect(displaySize(null, 3456, 1)).toBeNull();
  });
});

describe("masonry", () => {
  it("riempie le colonne da sinistra a destra finché sono pari", () => {
    expect(masonryColumns([1, 1, 1], 3)).toEqual([[0], [1], [2]]);
  });
  it("mette ogni foto nella colonna più bassa", () => {
    // colonna 0: una verticale alta (1.5); le tre orizzontali (0.66) stanno nella 1 finché è più bassa
    expect(masonryColumns([1.5, 0.66, 0.66, 0.66, 0.5], 2)).toEqual([[0, 4], [1, 2, 3]]);
  });
  it("non perde foto e accetta proporzioni sconosciute", () => {
    const cols = masonryColumns([NaN, 0, 1, 2, 0.5], 4);
    expect(cols.flat().sort()).toEqual([0, 1, 2, 3, 4]);
  });
  it("numero di colonne secondo la larghezza", () => {
    expect(columnsForWidth(375)).toBe(2);
    expect(columnsForWidth(960)).toBe(4);
    expect(columnsForWidth(3000)).toBe(6);
  });
});

describe("nomi e etichette", () => {
  it("nome del file scaricato", () => {
    expect(downloadName("IMG_4821.CR2", "original")).toBe("IMG_4821.CR2");
    expect(downloadName("IMG_4821.CR2", "preview")).toBe("IMG_4821.jpg");
    expect(downloadName('a"b/c.jpg', "preview")).toBe("a_b_c.jpg");
  });
  it("fotocamera senza marca ripetuta", () => {
    expect(cameraLabel("Canon", "Canon EOS 7D")).toBe("Canon EOS 7D");
    expect(cameraLabel("Apple", "iPhone 15")).toBe("Apple iPhone 15");
    expect(cameraLabel(null, null)).toBeNull();
  });
  it("dati di scatto", () => {
    expect(exposureLabel({ focal_length_mm: "50.0", aperture: "2.8", exposure_time: "1/250", iso: 400 })).toEqual([
      "50 mm",
      "f/2.8",
      "1/250 s",
      "ISO 400",
    ]);
  });
});
