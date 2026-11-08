/*
 * Calcoli geometrici dei volti, senza dipendenze: preparazione dell'immagine
 * per il rilevatore (SCRFD di InsightFace), lettura delle sue uscite,
 * eliminazione dei doppioni (NMS), allineamento del volto per il
 * riconoscimento (ArcFace) e riquadro della miniatura.
 *
 * Replica il comportamento di insightface/model_zoo/scrfd.py e
 * insightface/utils/face_align.py, così le impronte restano confrontabili
 * con quelle calcolate dalla libreria Python.
 */

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Detection {
  box: Box;
  /** 5 punti: occhio sx, occhio dx, naso, bocca sx, bocca dx (x, y alternati). */
  kps: number[];
  score: number;
}

// ---------------------------------------------------------------------
// Ridimensionamento per il rilevatore
// ---------------------------------------------------------------------

export interface Letterbox {
  /** Dimensione dell'immagine ridimensionata, in alto a sinistra nel quadrato. */
  width: number;
  height: number;
  /** Fattore immagine originale -> ingresso del modello. */
  scale: number;
}

/** Come SCRFD.detect: lato lungo = size, mantenendo le proporzioni. */
export function letterbox(width: number, height: number, size: number): Letterbox {
  const ratio = height / width;
  let w: number;
  let h: number;
  if (ratio > 1) {
    h = size;
    w = Math.trunc(h / ratio);
  } else {
    w = size;
    h = Math.trunc(w * ratio);
  }
  return { width: w, height: h, scale: h / height };
}

/**
 * Tensore NCHW dell'immagine per il rilevatore: RGB, (pixel - 127.5) / 128,
 * il resto del quadrato a zero come nell'originale (diventa -127.5/128).
 */
export function detectorInput(rgb: Uint8Array, lb: Letterbox, size: number): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane).fill(-127.5 / 128);
  for (let y = 0; y < lb.height; y++) {
    for (let x = 0; x < lb.width; x++) {
      const s = (y * lb.width + x) * 3;
      const d = y * size + x;
      out[d] = (rgb[s] - 127.5) / 128;
      out[plane + d] = (rgb[s + 1] - 127.5) / 128;
      out[2 * plane + d] = (rgb[s + 2] - 127.5) / 128;
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Uscite di SCRFD
// ---------------------------------------------------------------------

export const SCRFD_STRIDES = [8, 16, 32];
const ANCHORS_PER_CELL = 2;

/**
 * Converte le uscite del modello (per ogni passo: punteggi, distanze del
 * riquadro, distanze dei 5 punti) in rilevamenti nelle coordinate
 * dell'immagine originale, già filtrati per soglia e senza doppioni.
 */
export function decodeScrfd(
  outputs: { scores: Float32Array[]; boxes: Float32Array[]; kps: Float32Array[] },
  inputSize: number,
  scale: number,
  threshold = 0.5,
  nmsThreshold = 0.4,
): Detection[] {
  const found: Detection[] = [];
  SCRFD_STRIDES.forEach((stride, level) => {
    const scores = outputs.scores[level];
    const boxes = outputs.boxes[level];
    const kps = outputs.kps[level];
    const cols = Math.floor(inputSize / stride);
    for (let i = 0; i < scores.length; i++) {
      const score = scores[i];
      if (score < threshold) continue;
      const cell = Math.floor(i / ANCHORS_PER_CELL);
      const cx = (cell % cols) * stride;
      const cy = Math.floor(cell / cols) * stride;
      const b = i * 4;
      const box = {
        x1: (cx - boxes[b] * stride) / scale,
        y1: (cy - boxes[b + 1] * stride) / scale,
        x2: (cx + boxes[b + 2] * stride) / scale,
        y2: (cy + boxes[b + 3] * stride) / scale,
      };
      const points: number[] = [];
      for (let p = 0; p < 5; p++) {
        points.push((cx + kps[i * 10 + p * 2] * stride) / scale, (cy + kps[i * 10 + p * 2 + 1] * stride) / scale);
      }
      found.push({ box, kps: points, score });
    }
  });
  return nms(found, nmsThreshold);
}

/** Area con il +1 di insightface (coordinate in pixel interi). */
function area(b: Box): number {
  return Math.max(0, b.x2 - b.x1 + 1) * Math.max(0, b.y2 - b.y1 + 1);
}

export function iou(a: Box, b: Box): number {
  const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) + 1);
  const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) + 1);
  const inter = w * h;
  return inter / (area(a) + area(b) - inter);
}

/** Tiene il rilevamento migliore tra quelli che si sovrappongono troppo. */
export function nms(dets: Detection[], threshold: number): Detection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const d of sorted) {
    if (kept.every((k) => iou(k.box, d.box) <= threshold)) kept.push(d);
  }
  return kept;
}

// ---------------------------------------------------------------------
// Allineamento per ArcFace
// ---------------------------------------------------------------------

export const ARCFACE_SIZE = 112;

/** Posizione standard dei 5 punti in un volto allineato 112x112. */
export const ARCFACE_TEMPLATE = [
  38.2946, 51.6963, 73.5318, 51.5014, 56.0252, 71.7366, 41.5493, 92.3655, 70.7299, 92.2041,
];

/** Similitudine x' = a·x − b·y + tx, y' = b·x + a·y + ty. */
export interface Similarity {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

/**
 * Similitudine (rotazione, scala, traslazione) ai minimi quadrati che porta
 * i punti `src` su `dst` (Umeyama senza riflessione, come
 * skimage.transform.SimilarityTransform usato da insightface).
 */
export function estimateSimilarity(src: number[], dst: number[]): Similarity {
  const n = src.length / 2;
  let msx = 0, msy = 0, mdx = 0, mdy = 0;
  for (let i = 0; i < n; i++) {
    msx += src[2 * i]; msy += src[2 * i + 1];
    mdx += dst[2 * i]; mdy += dst[2 * i + 1];
  }
  msx /= n; msy /= n; mdx /= n; mdy /= n;
  let num1 = 0, num2 = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const xs = src[2 * i] - msx, ys = src[2 * i + 1] - msy;
    const xd = dst[2 * i] - mdx, yd = dst[2 * i + 1] - mdy;
    num1 += xs * xd + ys * yd;
    num2 += xs * yd - ys * xd;
    den += xs * xs + ys * ys;
  }
  const a = num1 / den;
  const b = num2 / den;
  return { a, b, tx: mdx - (a * msx - b * msy), ty: mdy - (b * msx + a * msy) };
}

export function applySimilarity(t: Similarity, x: number, y: number): [number, number] {
  return [t.a * x - t.b * y + t.tx, t.b * x + t.a * y + t.ty];
}

/**
 * Ritaglia il volto allineato (RGB, size x size) dall'immagine RGB con
 * interpolazione bilineare; fuori dall'immagine nero, come cv2.warpAffine.
 */
export function warpSimilarity(
  rgb: Uint8Array,
  width: number,
  height: number,
  t: Similarity,
  size = ARCFACE_SIZE,
): Uint8Array {
  const out = new Uint8Array(size * size * 3);
  const det = t.a * t.a + t.b * t.b;
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      // Trasformazione inversa: dal pixel di uscita al punto dell'immagine.
      const dx = u - t.tx, dy = v - t.ty;
      const x = (t.a * dx + t.b * dy) / det;
      const y = (-t.b * dx + t.a * dy) / det;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = x - x0, fy = y - y0;
      const o = (v * size + u) * 3;
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (const [px, py, wgt] of [
          [x0, y0, (1 - fx) * (1 - fy)],
          [x0 + 1, y0, fx * (1 - fy)],
          [x0, y0 + 1, (1 - fx) * fy],
          [x0 + 1, y0 + 1, fx * fy],
        ]) {
          if (wgt === 0 || px < 0 || py < 0 || px >= width || py >= height) continue;
          acc += rgb[(py * width + px) * 3 + c] * wgt;
        }
        out[o + c] = Math.round(acc);
      }
    }
  }
  return out;
}

/** Tensore NCHW per ArcFace: RGB, (pixel − 127.5) / 127.5. */
export function recognizerInput(rgb: Uint8Array, size = ARCFACE_SIZE): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    out[i] = (rgb[i * 3] - 127.5) / 127.5;
    out[plane + i] = (rgb[i * 3 + 1] - 127.5) / 127.5;
    out[2 * plane + i] = (rgb[i * 3 + 2] - 127.5) / 127.5;
  }
  return out;
}

// ---------------------------------------------------------------------
// Miniatura del volto
// ---------------------------------------------------------------------

/**
 * Quadrato attorno al volto (lato = margin × lato lungo del riquadro),
 * spostato per restare dentro l'immagine; più piccolo solo se l'immagine
 * stessa lo è.
 */
export function thumbnailRegion(box: Box, width: number, height: number, margin = 1.6) {
  const side = Math.round(Math.min(width, height, Math.max(box.x2 - box.x1, box.y2 - box.y1) * margin));
  const cx = (box.x1 + box.x2) / 2;
  const cy = (box.y1 + box.y2) / 2;
  const left = Math.round(Math.min(Math.max(cx - side / 2, 0), width - side));
  const top = Math.round(Math.min(Math.max(cy - side / 2, 0), height - side));
  return { left, top, width: side, height: side };
}
