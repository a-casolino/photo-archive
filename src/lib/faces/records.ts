import { iou, type Box, type Detection } from "./geometry";

/*
 * Passaggio tra i rilevamenti (pixel dell'anteprima) e le righe della
 * tabella `faces` (frazioni 0..1), e collegamento tra i volti di una
 * nuova analisi e quelli già salvati, per non perdere i nomi.
 */

export interface FractionBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function toFractions(box: Box, width: number, height: number): FractionBox {
  const x1 = clamp01(box.x1 / width);
  const y1 = clamp01(box.y1 / height);
  const x2 = clamp01(box.x2 / width);
  const y2 = clamp01(box.y2 / height);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function landmarkFractions(d: Detection, width: number, height: number): number[] {
  return d.kps.map((v, i) => Math.round(clamp01(v / (i % 2 === 0 ? width : height)) * 1e4) / 1e4);
}

function asBox(f: FractionBox): Box {
  // Scala fittizia per riusare l'IoU in pixel (con il suo +1).
  const s = 10_000;
  return { x1: f.x * s, y1: f.y * s, x2: (f.x + f.w) * s, y2: (f.y + f.h) * s };
}

/**
 * Per ogni volto nuovo, l'indice del volto già salvato nella stessa
 * posizione (IoU >= soglia), o -1. Ogni volto salvato si usa una volta,
 * a partire dalle coppie più sovrapposte.
 */
export function matchPrevious(previous: FractionBox[], current: FractionBox[], threshold = 0.5): number[] {
  const pairs: { p: number; c: number; v: number }[] = [];
  previous.forEach((pb, p) =>
    current.forEach((cb, c) => {
      const v = iou(asBox(pb), asBox(cb));
      if (v >= threshold) pairs.push({ p, c, v });
    }),
  );
  pairs.sort((a, b) => b.v - a.v);
  const result = current.map(() => -1);
  const used = new Set<number>();
  for (const { p, c } of pairs) {
    if (result[c] !== -1 || used.has(p)) continue;
    result[c] = p;
    used.add(p);
  }
  return result;
}

/** Chiave della miniatura di un volto, accanto alle anteprime. */
export function faceThumbKey(photoSha: string, index: number): string {
  return `faces/${photoSha.slice(0, 2)}/${photoSha}_${index}.jpg`;
}
