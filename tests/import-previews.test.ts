import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { applyOrientation } from "../scripts/import/previews";

// Immagine 3x2 con pixel tutti diversi: confronta la rotazione manuale
// (usata per il JPEG incorporato nei CR2) con quella automatica di sharp.
async function source() {
  const w = 3;
  const h = 2;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) raw.set([i * 40, 255 - i * 40, (i * 97) % 256], i * 3);
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe("applyOrientation", () => {
  for (let o = 1; o <= 8; o++) {
    it(`orientamento ${o} come sharp.rotate() con EXIF`, async () => {
      const png = await source();
      const tagged = await sharp(png).withMetadata({ orientation: o }).png().toBuffer();
      const auto = await sharp(tagged).rotate().raw().toBuffer({ resolveWithObject: true });
      const manual = await applyOrientation(sharp(png), o).raw().toBuffer({ resolveWithObject: true });
      expect([manual.info.width, manual.info.height]).toEqual([auto.info.width, auto.info.height]);
      expect(manual.data.equals(auto.data)).toBe(true);
    });
  }
});
