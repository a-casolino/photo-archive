import { describe, expect, it } from "vitest";
import { dHashHex, hamming, matchByPixels, parseHash, pathStem } from "../src/lib/phash-rules";

const d = (s: string) => new Date(`${s}Z`);

describe("dHashHex", () => {
  it("un bit per pixel più chiaro del successivo, riga per riga", () => {
    const decreasing = Array.from({ length: 72 }, (_, i) => 100 - (i % 9));
    expect(dHashHex(decreasing)).toBe("ffffffffffffffff");
    const increasing = Array.from({ length: 72 }, (_, i) => i % 9);
    expect(dHashHex(increasing)).toBe("0000000000000000");
  });

  it("rifiuta un numero di pixel sbagliato", () => {
    expect(() => dHashHex([1, 2, 3])).toThrow();
  });
});

describe("hamming", () => {
  it("conta i bit diversi su 64", () => {
    expect(hamming(parseHash("0000000000000000"), parseHash("ffffffffffffffff"))).toBe(64);
    expect(hamming(parseHash("8000000000000001"), parseHash("0000000000000000"))).toBe(2);
    expect(hamming(parseHash("a5a5a5a5a5a5a5a5"), parseHash("a5a5a5a5a5a5a5a5"))).toBe(0);
  });
});

describe("matchByPixels", () => {
  const h = (hex: string) => parseHash(hex);
  const raws = [
    { id: 1, hash: h("00000000000000ff"), taken: d("2016-07-10T00:18:38") },
    { id: 2, hash: h("ffffffff00000000"), taken: d("2016-07-10T00:20:00") },
    { id: 3, hash: h("0f0f0f0f0f0f0f0f"), taken: d("2016-07-10T00:30:00") },
    { id: 4, hash: h("0f0f0f0f0f0f0f0e"), taken: d("2016-07-10T00:30:01") },
  ];

  it("collega al CR2 quasi uguale anche con la data dell'export", () => {
    const r = matchByPixels([{ id: 10, hash: h("00000000000000fc"), taken: d("2016-07-10T16:08:36") }], raws);
    expect(r.auto).toEqual([{ exportId: 10, rawId: 1, distance: 2 }]);
  });

  it("raffica: due CR2 quasi uguali, nessun collegamento automatico", () => {
    const r = matchByPixels([{ id: 11, hash: h("0f0f0f0f0f0f0f0f"), taken: null }], raws);
    expect(r.auto).toEqual([]);
    expect(r.ambiguous).toBe(1);
  });

  it("troppo diverso: niente", () => {
    const r = matchByPixels([{ id: 12, hash: h("123456789abcdef0"), taken: null }], raws);
    expect(r).toEqual({ auto: [], ambiguous: 0 });
  });

  it("non collega a un CR2 scattato molto dopo l'export", () => {
    const r = matchByPixels([{ id: 13, hash: h("00000000000000ff"), taken: d("2016-07-08T00:00:00") }], raws);
    expect(r.auto).toEqual([]);
  });
});

describe("pathStem", () => {
  it("toglie solo l'estensione del file", () => {
    expect(pathStem("2012/01-01 Capodanno/IMG_6909.JPG")).toBe("2012/01-01 capodanno/img_6909");
    expect(pathStem("2012/cartella.v2/IMG_6909")).toBe("2012/cartella.v2/img_6909");
  });
});
