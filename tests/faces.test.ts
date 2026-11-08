import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeEmbedding, encodeEmbedding, normalize, similarity } from "../src/lib/faces/embedding";
import {
  applySimilarity,
  ARCFACE_TEMPLATE,
  decodeScrfd,
  detectorInput,
  estimateSimilarity,
  letterbox,
  nms,
  thumbnailRegion,
  warpSimilarity,
} from "../src/lib/faces/geometry";
import { faceThumbKey, matchPrevious, toFractions } from "../src/lib/faces/records";
import { zipEntries, zipExtract } from "../scripts/volti/models";

describe("letterbox", () => {
  it("foto orizzontale: lato lungo = size", () => {
    expect(letterbox(2048, 1365, 640)).toEqual({ width: 640, height: 426, scale: 426 / 1365 });
  });
  it("foto verticale", () => {
    const lb = letterbox(1365, 2048, 640);
    expect([lb.width, lb.height]).toEqual([426, 640]);
    expect(lb.scale).toBeCloseTo(640 / 2048);
  });
  it("riempie il resto del quadrato con il nero normalizzato", () => {
    const lb = { width: 1, height: 1, scale: 1 };
    const t = detectorInput(new Uint8Array([255, 127.5, 0]), lb, 2);
    expect(t[0]).toBeCloseTo(127.5 / 128);
    expect(t[1]).toBeCloseTo(-127.5 / 128);
    expect(t[8]).toBeCloseTo(-127.5 / 128); // blu del primo pixel
  });
});

describe("decodeScrfd", () => {
  // Ingresso 64x64: passi 8, 16, 32 -> 8x8, 4x4, 2x2 celle, 2 ancore ciascuna.
  const size = 64;
  function empty() {
    return [8, 16, 32].map((s) => (size / s) ** 2 * 2);
  }
  it("posiziona riquadro e punti rispetto al centro dell'ancora", () => {
    const counts = empty();
    const scores = counts.map((n) => new Float32Array(n));
    const boxes = counts.map((n) => new Float32Array(n * 4));
    const kps = counts.map((n) => new Float32Array(n * 10));
    // Passo 16, cella (x=2, y=1) -> centro (32, 16); ancora 1 -> indice (1*4+2)*2+1 = 13.
    const i = 13;
    scores[1][i] = 0.9;
    boxes[1].set([1, 0.5, 1, 1.5], i * 4); // distanze in passi
    kps[1].set([-0.5, 0, 0.5, 0, 0, 0.25, -0.25, 0.5, 0.25, 0.5], i * 10);
    const [d, ...rest] = decodeScrfd({ scores, boxes, kps }, size, 0.5);
    expect(rest).toHaveLength(0);
    // Coordinate divise per scale = 0.5 (l'originale era il doppio).
    expect(d.box).toEqual({ x1: 32, y1: 16, x2: 96, y2: 80 });
    expect(d.kps.slice(0, 4)).toEqual([48, 32, 80, 32]);
    expect(d.score).toBeCloseTo(0.9);
  });
  it("ignora i punteggi sotto soglia", () => {
    const counts = empty();
    const scores = counts.map((n) => new Float32Array(n).fill(0.3));
    const out = decodeScrfd(
      { scores, boxes: counts.map((n) => new Float32Array(n * 4)), kps: counts.map((n) => new Float32Array(n * 10)) },
      size,
      1,
    );
    expect(out).toHaveLength(0);
  });
});

describe("nms", () => {
  it("tiene il migliore tra due riquadri quasi uguali e lascia quelli lontani", () => {
    const d = (x: number, score: number) => ({ box: { x1: x, y1: 0, x2: x + 100, y2: 100 }, kps: [], score });
    const kept = nms([d(0, 0.7), d(5, 0.9), d(300, 0.6)], 0.4);
    expect(kept.map((k) => k.score)).toEqual([0.9, 0.6]);
  });
});

describe("allineamento", () => {
  it("ritrova una similitudine nota", () => {
    const t = { a: 0.8, b: 0.3, tx: 12, ty: -5 };
    const src = [10, 20, 60, 25, 35, 50, 15, 80, 55, 85];
    const dst = src.flatMap((_, i) => (i % 2 ? [] : applySimilarity(t, src[i], src[i + 1])));
    const est = estimateSimilarity(src, dst);
    expect(est.a).toBeCloseTo(t.a, 6);
    expect(est.b).toBeCloseTo(t.b, 6);
    expect(est.tx).toBeCloseTo(t.tx, 6);
    expect(est.ty).toBeCloseTo(t.ty, 6);
  });
  it("con i punti già nella posizione standard non sposta nulla", () => {
    const t = estimateSimilarity(ARCFACE_TEMPLATE, ARCFACE_TEMPLATE);
    expect(t.a).toBeCloseTo(1);
    expect(t.b).toBeCloseTo(0);
    const img = new Uint8Array(112 * 112 * 3).map((_, i) => i % 251);
    expect(Buffer.from(warpSimilarity(img, 112, 112, t)).equals(Buffer.from(img))).toBe(true);
  });
  it("fuori dall'immagine è nero", () => {
    const img = new Uint8Array(4 * 4 * 3).fill(200);
    const out = warpSimilarity(img, 4, 4, { a: 1, b: 0, tx: 0, ty: 0 }, 8);
    expect(out[0]).toBe(200);
    expect(out[(7 * 8 + 7) * 3]).toBe(0);
  });
});

describe("impronte", () => {
  it("normalizza, confronta e passa per il database senza perdite", () => {
    const v = normalize(new Float32Array([3, 4]));
    expect(Array.from(v)).toEqual([expect.closeTo(0.6), expect.closeTo(0.8)]);
    expect(similarity(v, v)).toBeCloseTo(1);
    const buf = encodeEmbedding(v);
    expect(buf.length).toBe(8);
    expect(Array.from(decodeEmbedding(buf))).toEqual(Array.from(v));
  });
});

describe("volti salvati", () => {
  it("frazioni dentro 0..1", () => {
    expect(toFractions({ x1: -10, y1: 50, x2: 100, y2: 250 }, 200, 200)).toEqual({ x: 0, y: 0.25, w: 0.5, h: 0.75 });
  });
  it("collega i volti nella stessa posizione e lascia nuovi gli altri", () => {
    const prev = [
      { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      { x: 0.6, y: 0.6, w: 0.2, h: 0.2 },
    ];
    const cur = [
      { x: 0.61, y: 0.6, w: 0.2, h: 0.21 },
      { x: 0.3, y: 0.7, w: 0.1, h: 0.1 },
      { x: 0.11, y: 0.1, w: 0.2, h: 0.2 },
    ];
    expect(matchPrevious(prev, cur)).toEqual([1, -1, 0]);
  });
  it("miniatura quadrata dentro l'immagine", () => {
    expect(thumbnailRegion({ x1: 0, y1: 0, x2: 50, y2: 80 }, 1000, 600)).toEqual({ left: 0, top: 0, width: 128, height: 128 });
    expect(thumbnailRegion({ x1: 900, y1: 500, x2: 1000, y2: 600 }, 1000, 600).left).toBe(840);
  });
  it("chiave della miniatura accanto alle anteprime", () => {
    expect(faceThumbKey("ab12" + "0".repeat(60), 3)).toBe(`faces/ab/ab12${"0".repeat(60)}_3.jpg`);
  });
});

describe("zip dei modelli", () => {
  it("legge file compressi e non", () => {
    const files = [
      { name: "buffalo_l/det_10g.onnx", data: Buffer.from("rilevatore ".repeat(50)), method: 8 },
      { name: "w600k_r50.onnx", data: Buffer.from("arcface"), method: 0 },
    ];
    const locals: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const f of files) {
      const body = f.method === 8 ? deflateRawSync(f.data) : f.data;
      const name = Buffer.from(f.name);
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(f.method, 8);
      lh.writeUInt32LE(body.length, 18);
      lh.writeUInt32LE(f.data.length, 22);
      lh.writeUInt16LE(name.length, 26);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt16LE(f.method, 10);
      ch.writeUInt32LE(body.length, 20);
      ch.writeUInt32LE(f.data.length, 24);
      ch.writeUInt16LE(name.length, 28);
      ch.writeUInt32LE(offset, 42);
      locals.push(lh, name, body);
      central.push(ch, name);
      offset += 30 + name.length + body.length;
    }
    const cd = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    const zip = Buffer.concat([...locals, cd, eocd]);
    const entries = zipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    entries.forEach((e, i) => expect(zipExtract(zip, e).equals(files[i].data)).toBe(true));
  });
});
