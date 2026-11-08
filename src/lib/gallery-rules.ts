/*
 * Regole pure di gallerie e condivisioni (niente database): usate dalle
 * pagine e verificate dai test in tests/gallery-rules.test.ts.
 */

export type ShareState = "active" | "expired" | "revoked";

export function shareState(s: { revoked_at: Date | null; expires_at: Date | null }, now = new Date()): ShareState {
  if (s.revoked_at) return "revoked";
  if (s.expires_at && s.expires_at.getTime() <= now.getTime()) return "expired";
  return "active";
}

export const SHARE_STATE_LABEL: Record<ShareState, string> = {
  active: "Attiva",
  expired: "Scaduta",
  revoked: "Revocata",
};

/** Scadenza di un link libero: tra `days` giorni da adesso. */
export function linkExpiry(days: number, now = new Date()): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

/**
 * Proporzioni con cui si vede la foto. width/height sono quelli del file
 * originale; con Orientation EXIF 5..8 la foto è ruotata di 90° e le
 * anteprime (già ruotate dall'import) hanno i lati scambiati.
 */
export function displaySize(
  width: number | null,
  height: number | null,
  orientation: number | null,
): { width: number; height: number } | null {
  if (!width || !height) return null;
  return orientation && orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

/**
 * Masonry: distribuisce le foto in colonne mettendo ogni foto nella colonna
 * più bassa in quel momento. L'ordine di lettura resta da sinistra a destra
 * e dall'alto in basso (a differenza delle colonne CSS, che riempiono
 * prima tutta la prima colonna). `ratios` = altezza / larghezza.
 * Restituisce, per ogni colonna, gli indici delle foto.
 */
export function masonryColumns(ratios: number[], columns: number): number[][] {
  const n = Math.max(1, Math.floor(columns));
  const cols: number[][] = Array.from({ length: n }, () => []);
  const heights = new Array<number>(n).fill(0);
  ratios.forEach((r, i) => {
    let best = 0;
    for (let c = 1; c < n; c++) if (heights[c] < heights[best] - 1e-9) best = c;
    cols[best].push(i);
    heights[best] += Number.isFinite(r) && r > 0 ? r : 1;
  });
  return cols;
}

/** Numero di colonne per una larghezza in pixel (colonne di almeno ~240 px). */
export function columnsForWidth(width: number): number {
  if (width < 520) return 2;
  return Math.min(6, Math.max(2, Math.floor(width / 240)));
}

/** Nome del file scaricato: "IMG_4821.jpg" per il JPEG, nome originale per l'originale. */
export function downloadName(originalFilename: string, version: "preview" | "original"): string {
  const clean = originalFilename.replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(-150) || "foto";
  if (version === "original") return clean;
  return clean.replace(/\.[^.]*$/, "") + ".jpg";
}

/** Camera leggibile: evita "Canon Canon EOS 7D". */
export function cameraLabel(make: string | null, model: string | null): string | null {
  if (!model && !make) return null;
  if (!make) return model;
  if (!model) return make;
  return model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`;
}

/** "1/250 s", "2 s", "f/2.8", "50 mm". */
export function exposureLabel(p: {
  aperture: number | string | null;
  exposure_time: string | null;
  iso: number | null;
  focal_length_mm: number | string | null;
}): string[] {
  const out: string[] = [];
  if (p.focal_length_mm !== null && p.focal_length_mm !== undefined) out.push(`${Number(p.focal_length_mm)} mm`);
  if (p.aperture !== null && p.aperture !== undefined) out.push(`f/${Number(p.aperture)}`);
  if (p.exposure_time) out.push(`${p.exposure_time} s`);
  if (p.iso) out.push(`ISO ${p.iso}`);
  return out;
}
