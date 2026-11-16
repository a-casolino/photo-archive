/*
 * Impronta visiva delle foto (richiesta di Antonio del 2026-11-16).
 *
 * Serve a collegare al CR2 gli export che non hanno né il nome né i dati della
 * fotocamera (es. "catia 30 (23 di 100).jpg", rinominato all'export, senza
 * EXIF, ridotto, con la data dell'export). Si usa un "difference hash": la
 * miniatura in scala di grigi ridotta a 9×8, e per ogni riga 8 bit che dicono
 * se un pixel è più chiaro del successivo. Resiste a ridimensionamento,
 * ricompressione e regolazioni moderate di luce e colore; non a ritagli
 * importanti o raddrizzamenti.
 *
 * L'impronta (64 bit) si salva come 16 cifre esadecimali: in JavaScript un
 * BIGINT di MySQL perderebbe precisione.
 */

export const HASH_WIDTH = 9;
export const HASH_HEIGHT = 8;

/** Bit diversi al massimo per un collegamento automatico (su 64). */
export const PIXEL_AUTO_MAX = 6;
/** Il secondo CR2 più simile deve stare almeno così lontano dal primo (raffiche). */
export const PIXEL_MARGIN = 3;
/** L'export può avere una data fino a tanto prima del CR2 (fusi orari). */
export const PIXEL_EARLY_MS = 26 * 3600 * 1000;

/** dHash da 9×8 pixel in scala di grigi (riga per riga), in esadecimale. */
export function dHashHex(gray: ArrayLike<number>): string {
  if (gray.length !== HASH_WIDTH * HASH_HEIGHT) throw new Error(`Servono ${HASH_WIDTH * HASH_HEIGHT} pixel`);
  let hex = "";
  for (let y = 0; y < HASH_HEIGHT; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) {
      const i = y * HASH_WIDTH + x;
      byte = (byte << 1) | (gray[i] > gray[i + 1] ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export type Hash = { hi: number; lo: number };

export function parseHash(hex: string): Hash {
  if (!/^[0-9a-f]{16}$/i.test(hex)) throw new Error(`Impronta non valida: ${hex}`);
  return { hi: parseInt(hex.slice(0, 8), 16) >>> 0, lo: parseInt(hex.slice(8), 16) >>> 0 };
}

function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Quanti bit sono diversi tra due impronte (0 = identiche, 64 = opposte). */
export function hamming(a: Hash, b: Hash): number {
  return popcount32((a.hi ^ b.hi) >>> 0) + popcount32((a.lo ^ b.lo) >>> 0);
}

export type HashedPhoto = { id: number; hash: Hash; taken: Date | null };

export type PixelMatches = {
  auto: { exportId: number; rawId: number; distance: number }[];
  /** Più CR2 quasi uguali (raffiche): non si collega in automatico. */
  ambiguous: number;
};

/**
 * Per ogni export, il CR2 con l'impronta più vicina. Si collega solo se è
 * entro PIXEL_AUTO_MAX bit e il secondo è lontano almeno PIXEL_MARGIN in più.
 * Se entrambe le date ci sono, il CR2 non può essere scattato più di
 * PIXEL_EARLY_MS dopo l'export (l'export viene dopo lo scatto).
 */
export function matchByPixels(exports: HashedPhoto[], raws: HashedPhoto[]): PixelMatches {
  const out: PixelMatches = { auto: [], ambiguous: 0 };
  for (const e of exports) {
    const te = e.taken?.getTime();
    let best = 65, second = 65, bestId = -1;
    for (const r of raws) {
      const tr = r.taken?.getTime();
      if (te !== undefined && tr !== undefined && tr - te > PIXEL_EARLY_MS) continue;
      const d = hamming(e.hash, r.hash);
      if (d < best) {
        second = best;
        best = d;
        bestId = r.id;
      } else if (d < second) {
        second = d;
      }
    }
    if (best > PIXEL_AUTO_MAX) continue;
    if (second - best < PIXEL_MARGIN) {
      out.ambiguous++;
      continue;
    }
    out.auto.push({ exportId: e.id, rawId: bestId, distance: best });
  }
  return out;
}

/** Percorso senza l'ultima estensione, in minuscolo (per riconoscere le coppie RAW+JPEG). */
export function pathStem(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  return (dot > slash ? path.slice(0, dot) : path).toLowerCase();
}
