/*
 * Ritaglio "intelligente" delle copertine degli album.
 *
 * Le copertine dell'elenco album sono tutte 4:3 e ritagliate (object-fit:
 * cover): una foto verticale perde sopra e sotto quasi metà dell'altezza e,
 * centrata, spesso taglia le teste. Se nella foto ci sono volti (riquadri in
 * frazioni 0..1 dell'anteprima ruotata, tabella faces) si sposta il ritaglio
 * (object-position) quanto basta perché restino dentro; senza volti, o se
 * sono già dentro, resta centrato.
 *
 * Funzioni pure: le prove sono in tests/cover-focus.test.ts.
 */

export type FaceBox = { x: number; y: number; w: number; h: number };

/** Proporzione (larghezza / altezza) delle copertine della griglia album. */
export const COVER_ASPECT = 4 / 3;

/**
 * Volti più piccoli di questa frazione dell'area del volto più grande non
 * contano: sono di solito persone sullo sfondo.
 */
const MIN_AREA_RATIO = 0.2;
/** Margini intorno al volto, in frazioni della sua altezza/larghezza: capelli sopra, mento sotto. */
const PAD_TOP = 0.45;
const PAD_BOTTOM = 0.2;
const PAD_SIDE = 0.15;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function validBox(b: FaceBox): boolean {
  return [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0 && b.x < 1 && b.y < 1 && b.x + b.w > 0 && b.y + b.h > 0;
}

/**
 * Posizione della finestra visibile su un asse, come frazione 0..1 per
 * object-position. `visible` = parte dell'asse che resta visibile (0..1);
 * `lo`/`hi` = zona da tenere dentro (già con i margini); `focus` = punto da
 * tenere comunque se la zona non ci sta tutta.
 */
function axisPosition(visible: number, lo: number, hi: number, focus: number): number {
  if (visible >= 0.999) return 0.5; // su questo asse non si taglia niente
  const centered = (1 - visible) / 2;
  // La zona ci sta: ci si sposta dal centro solo quanto basta a farla entrare,
  // così l'inquadratura cambia il meno possibile. Altrimenti si centra il punto principale.
  const offset =
    hi - lo <= visible ? clamp(centered, hi - visible, lo) : clamp(focus - visible / 2, 0, 1 - visible);
  return clamp(offset, 0, 1 - visible) / (1 - visible);
}

/**
 * object-position ("50% 18%") che tiene visibili i volti in una copertina
 * di proporzione `target` (larghezza / altezza) ricavata da una foto di
 * proporzione `aspect`. null se non ci sono volti utili: resta il centro.
 *
 * Calcolata per la griglia 4:3; usata anche per le miniature quadrate della
 * vista lista, dove la finestra è più alta e i volti restano comunque dentro.
 */
export function coverObjectPosition(
  faces: readonly FaceBox[],
  aspect: number | null,
  target: number = COVER_ASPECT,
): string | null {
  const boxes = faces.filter(validBox);
  if (!boxes.length || !aspect || !Number.isFinite(aspect) || aspect <= 0) return null;
  const area = (b: FaceBox) => b.w * b.h;
  const biggest = boxes.reduce((a, b) => (area(b) > area(a) ? b : a));
  const main = boxes.filter((b) => area(b) >= area(biggest) * MIN_AREA_RATIO);

  // Zona dei volti principali, con un po' di margine; e, se non ci sta tutta, il volto più grande.
  const top = clamp(Math.min(...main.map((b) => b.y - b.h * PAD_TOP)), 0, 1);
  const bottom = clamp(Math.max(...main.map((b) => b.y + b.h * (1 + PAD_BOTTOM))), 0, 1);
  const left = clamp(Math.min(...main.map((b) => b.x - b.w * PAD_SIDE)), 0, 1);
  const right = clamp(Math.max(...main.map((b) => b.x + b.w * (1 + PAD_SIDE))), 0, 1);
  const focusY = clamp(biggest.y + biggest.h * 0.4, 0, 1);
  const focusX = clamp(biggest.x + biggest.w / 2, 0, 1);

  // Foto più stretta della copertina: si taglia in altezza; più larga: in larghezza.
  const visibleY = Math.min(1, aspect / target);
  const visibleX = Math.min(1, target / aspect);
  const py = axisPosition(visibleY, top, bottom, focusY);
  const px = axisPosition(visibleX, left, right, focusX);
  if (Math.abs(py - 0.5) < 0.005 && Math.abs(px - 0.5) < 0.005) return null;
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
  return `${pct(px)} ${pct(py)}`;
}
