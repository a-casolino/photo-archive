/*
 * Anteprime nel browser: dimensioni e orientamento. Funzioni pure, testate
 * in tests/upload-image-rules.test.ts contro le anteprime di sharp del
 * programma di import, così le due strade danno la stessa immagine.
 */

/** Lato lungo al massimo `max`, senza ingrandire. */
export function fitInside(w: number, h: number, max: number): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/**
 * Trasformazione del canvas per disegnare dritta un'immagine (già
 * rimpicciolita a w×h) con orientamento EXIF 1..8: dimensioni del canvas e
 * matrice [a, b, c, d, e, f] per setTransform(). Serve per il JPEG
 * incorporato nei CR2, che non porta l'orientamento.
 */
export function orientationTransform(
  orientation: number | null,
  w: number,
  h: number,
): { width: number; height: number; matrix: [number, number, number, number, number, number] } {
  switch (orientation) {
    case 2:
      return { width: w, height: h, matrix: [-1, 0, 0, 1, w, 0] };
    case 3:
      return { width: w, height: h, matrix: [-1, 0, 0, -1, w, h] };
    case 4:
      return { width: w, height: h, matrix: [1, 0, 0, -1, 0, h] };
    case 5:
      return { width: h, height: w, matrix: [0, 1, 1, 0, 0, 0] };
    case 6:
      return { width: h, height: w, matrix: [0, 1, -1, 0, h, 0] };
    case 7:
      return { width: h, height: w, matrix: [0, -1, -1, 0, h, w] };
    case 8:
      return { width: h, height: w, matrix: [0, -1, 1, 0, 0, w] };
    default:
      return { width: w, height: h, matrix: [1, 0, 0, 1, 0, 0] };
  }
}

/** Il JPEG più grande incorporato in un RAW, dai tag di ExifTool (posizione e lunghezza nel file). */
export function embeddedJpegRange(tags: Record<string, unknown>): { start: number; length: number; tag: string } | null {
  const candidates: { start: number; length: number; tag: string }[] = [];
  const add = (tag: string, start: unknown, length: unknown) => {
    const s = Number(start);
    const l = Number(length);
    if (Number.isFinite(s) && Number.isFinite(l) && s > 0 && l > 1000) candidates.push({ start: s, length: l, tag });
  };
  add("JpgFromRaw", tags.JpgFromRawStart, tags.JpgFromRawLength);
  add("PreviewImage", tags.PreviewImageStart, tags.PreviewImageLength);
  add("ThumbnailImage", tags.ThumbnailOffset, tags.ThumbnailLength);
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] ?? null;
}
