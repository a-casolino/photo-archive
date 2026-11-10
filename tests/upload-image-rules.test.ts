import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { embeddedJpegRange, fitInside, orientationTransform } from "../src/lib/upload/image-rules";

// Stessa immagine 3x2 di import-previews.test.ts: la matrice del canvas
// (anteprime nel browser) deve dare la stessa foto di sharp con l'EXIF.
async function source() {
  const w = 3;
  const h = 2;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) raw.set([i * 40, 255 - i * 40, (i * 97) % 256], i * 3);
  return { w, h, raw, png: await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer() };
}

describe("orientationTransform", () => {
  for (let o = 1; o <= 8; o++) {
    it(`orientamento ${o} come sharp.rotate() con EXIF`, async () => {
      const { w, h, raw, png } = await source();
      const t = orientationTransform(o, w, h);
      const [a, b, c, d, e, f] = t.matrix;
      const out = Buffer.alloc(t.width * t.height * 3);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          // Centro del pixel trasformato come fa il canvas con setTransform.
          const cx = x + 0.5;
          const cy = y + 0.5;
          const dx = Math.floor(a * cx + c * cy + e);
          const dy = Math.floor(b * cx + d * cy + f);
          raw.copy(out, (dy * t.width + dx) * 3, (y * w + x) * 3, (y * w + x) * 3 + 3);
        }
      }
      const tagged = await sharp(png).withMetadata({ orientation: o }).png().toBuffer();
      const auto = await sharp(tagged).rotate().raw().toBuffer({ resolveWithObject: true });
      expect([t.width, t.height]).toEqual([auto.info.width, auto.info.height]);
      expect(out.equals(auto.data)).toBe(true);
    });
  }

  it("senza orientamento non trasforma", () => {
    expect(orientationTransform(null, 30, 20)).toEqual({ width: 30, height: 20, matrix: [1, 0, 0, 1, 0, 0] });
  });
});

describe("fitInside", () => {
  it("rimpicciolisce sul lato lungo senza ingrandire", () => {
    expect(fitInside(5184, 3456, 2048)).toEqual({ w: 2048, h: 1365 });
    expect(fitInside(3456, 5184, 2048)).toEqual({ w: 1365, h: 2048 });
    expect(fitInside(800, 600, 2048)).toEqual({ w: 800, h: 600 });
  });
});

describe("embeddedJpegRange", () => {
  it("sceglie il JPEG incorporato più grande", () => {
    expect(
      embeddedJpegRange({
        PreviewImageStart: 11600,
        PreviewImageLength: 2_500_000,
        ThumbnailOffset: 8620,
        ThumbnailLength: 9000,
      }),
    ).toEqual({ start: 11600, length: 2_500_000, tag: "PreviewImage" });
    expect(embeddedJpegRange({ JpgFromRawStart: 100, JpgFromRawLength: 5_000_000, PreviewImageStart: 50, PreviewImageLength: 2000 })?.tag).toBe(
      "JpgFromRaw",
    );
  });

  it("ignora anteprime minuscole o assenti", () => {
    expect(embeddedJpegRange({ PreviewImageStart: 8680, PreviewImageLength: 26 })).toBeNull();
    expect(embeddedJpegRange({})).toBeNull();
  });
});
