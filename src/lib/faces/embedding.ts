/*
 * Impronte dei volti: vettori di 512 numeri (ArcFace), normalizzati a
 * lunghezza 1, così la somiglianza è il prodotto scalare (coseno).
 * Nel database stanno come VARBINARY(2048): 512 float32 little-endian.
 *
 * Sono dati biometrici: restano nel database e nel programma che le
 * calcola, non vanno mai mandate al browser.
 */

export const EMBEDDING_DIM = 512;

export function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** Somiglianza tra due impronte normalizzate: 1 identiche, ~0 estranee. */
export function similarity(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function encodeEmbedding(v: Float32Array): Buffer {
  const buf = Buffer.alloc(v.length * 4);
  v.forEach((x, i) => buf.writeFloatLE(x, i * 4));
  return buf;
}

export function decodeEmbedding(buf: Uint8Array): Float32Array {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Float32Array(buf.byteLength / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}
