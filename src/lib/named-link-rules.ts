/*
 * Regole dei link con nome (/l/<nome>), senza database: si possono testare.
 *
 * Il nome è di 2-30 caratteri: minuscole, numeri e trattini, senza trattini
 * all'inizio, alla fine o doppi. I token dei link liberi casuali sono di 32
 * caratteri base62: in /l/<x> la lunghezza dice di che link si tratta.
 */

export const SLUG_MIN = 2;
export const SLUG_MAX = 30;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOKEN_RE = /^[0-9A-Za-z]{32}$/;

/** "Matrimonio Anna" → "matrimonio-anna"; "Città_2026" → "citta-2026". */
export function normalizeSlug(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_.]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Cosa non va nel nome (già normalizzato), o null se va bene. */
export function slugProblem(slug: string): string | null {
  if (slug.length < SLUG_MIN) return `Il nome deve avere almeno ${SLUG_MIN} caratteri.`;
  if (slug.length > SLUG_MAX) return `Il nome può avere al massimo ${SLUG_MAX} caratteri.`;
  if (!SLUG_RE.test(slug)) return "Solo lettere minuscole, numeri e trattini.";
  return null;
}

/** Che cosa c'è dopo /l/: il token di un link libero, il nome di un link con nome, o niente di valido. */
export function linkKeyKind(key: string): "token" | "slug" | null {
  if (TOKEN_RE.test(key)) return "token";
  const slug = key.toLowerCase();
  return slug.length <= SLUG_MAX && slugProblem(slug) === null ? "slug" : null;
}
