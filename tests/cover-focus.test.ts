import { describe, expect, it } from "vitest";
import { coverObjectPosition } from "../src/lib/cover-focus-rules";

/** Frazione verticale 0..1 dell'object-position "X% Y%". */
const posY = (s: string | null) => (s ? Number(s.split(" ")[1].replace("%", "")) / 100 : 0.5);
const posX = (s: string | null) => (s ? Number(s.split(" ")[0].replace("%", "")) / 100 : 0.5);

/** Parte della foto (in frazioni) che resta visibile in verticale nella copertina 4:3. */
function windowY(aspect: number, pos: string | null) {
  const v = Math.min(1, aspect / (4 / 3));
  const top = (1 - v) * posY(pos);
  return [top, top + v];
}

const portrait = 2 / 3; // foto verticale 2:3

describe("coverObjectPosition", () => {
  it("senza volti resta centrata", () => {
    expect(coverObjectPosition([], portrait)).toBeNull();
    expect(coverObjectPosition([{ x: 0.4, y: 0.1, w: 0.2, h: 0.1 }], null)).toBeNull();
  });

  it("verticale con un volto in alto: il ritaglio sale e il volto resta dentro", () => {
    const face = { x: 0.4, y: 0.08, w: 0.2, h: 0.12 };
    const pos = coverObjectPosition([face], portrait);
    const [top, bottom] = windowY(portrait, pos);
    expect(top).toBeLessThanOrEqual(face.y);
    expect(bottom).toBeGreaterThanOrEqual(face.y + face.h);
    expect(posY(pos)).toBeLessThan(0.5);
  });

  it("verticale con un volto in basso: il ritaglio scende", () => {
    const face = { x: 0.3, y: 0.8, w: 0.15, h: 0.1 };
    const pos = coverObjectPosition([face], portrait);
    const [top, bottom] = windowY(portrait, pos);
    expect(top).toBeLessThanOrEqual(face.y);
    expect(bottom).toBeGreaterThanOrEqual(face.y + face.h);
  });

  it("più volti: li tiene tutti, i volti piccoli sullo sfondo non contano", () => {
    const a = { x: 0.2, y: 0.2, w: 0.2, h: 0.12 };
    const b = { x: 0.6, y: 0.45, w: 0.2, h: 0.12 };
    const tiny = { x: 0.5, y: 0.95, w: 0.02, h: 0.02 };
    const pos = coverObjectPosition([a, b, tiny], portrait);
    const [top, bottom] = windowY(portrait, pos);
    expect(top).toBeLessThanOrEqual(a.y);
    expect(bottom).toBeGreaterThanOrEqual(b.y + b.h);
  });

  it("volti troppo distanti per stare tutti: tiene il più grande", () => {
    const big = { x: 0.4, y: 0.05, w: 0.3, h: 0.18 };
    const low = { x: 0.4, y: 0.85, w: 0.2, h: 0.1 };
    const pos = coverObjectPosition([big, low], portrait);
    const [top, bottom] = windowY(portrait, pos);
    expect(top).toBeLessThanOrEqual(big.y);
    expect(bottom).toBeGreaterThanOrEqual(big.y + big.h);
  });

  it("volto già dentro il ritaglio centrato: nessuno spostamento", () => {
    expect(coverObjectPosition([{ x: 0.4, y: 0.42, w: 0.2, h: 0.13 }], portrait)).toBeNull();
  });

  it("foto orizzontale larga (panorama): sposta in orizzontale", () => {
    const pos = coverObjectPosition([{ x: 0.05, y: 0.4, w: 0.08, h: 0.2 }], 3);
    expect(posX(pos)).toBeLessThan(0.2);
    expect(posY(pos)).toBe(0.5);
  });

  it("foto 4:3 come la copertina: niente da spostare", () => {
    expect(coverObjectPosition([{ x: 0.05, y: 0.05, w: 0.1, h: 0.1 }], 4 / 3)).toBeNull();
  });

  it("ignora riquadri non validi", () => {
    expect(coverObjectPosition([{ x: NaN, y: 0.1, w: 0.1, h: 0.1 }], portrait)).toBeNull();
  });
});
