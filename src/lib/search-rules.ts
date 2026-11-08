/*
 * Regole pure della ricerca con suggerimenti (niente database, usabili
 * anche nel browser): verificate dai test in tests/search-rules.test.ts.
 */

/** Lunghezza massima del testo cercato. */
export const SEARCH_MAX_LENGTH = 100;

/** Suggerimenti al massimo per ogni gruppo (album, tag, persone). */
export const SUGGEST_LIMIT = 5;

/** Un suggerimento come arriva al browser da /api/suggerimenti. */
export type SuggestItem = {
  kind: "album" | "tag" | "person";
  href: string;
  title: string;
  detail: string;
  thumb: string | null;
};

export type SuggestResponse = { items: SuggestItem[] };

export const SUGGEST_GROUP_LABEL: Record<SuggestItem["kind"], string> = {
  album: "Album",
  tag: "Tag",
  person: "Persone",
};

/** Testo da cercare: spazi ripuliti e accorciato; "" se non c'è niente. */
export function parseSearchQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH);
}

/** Protegge %, _ e \ per usare il testo dentro un LIKE di MySQL. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Lettera senza accenti e in minuscolo, come la collation `utf8mb4_0900_ai_ci`. */
function fold(c: string): string {
  return c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function matchIndex(folded: string, q: string): number {
  const first = folded.indexOf(q);
  if (first <= 0) return first;
  for (let i = first; i >= 0; i = folded.indexOf(q, i + 1)) {
    if (folded[i - 1] === " ") return i;
  }
  return first;
}

/**
 * Divide `text` nei pezzi da mostrare normali e in evidenza (dove
 * compare `query`), senza badare a maiuscole e accenti: "citta" evidenzia
 * "Città". Evidenzia una sola occorrenza, la stessa che conta per
 * l'ordine dei suggerimenti: a inizio nome, poi a inizio parola, poi la prima.
 */
export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
  const q = [...query.trim()].map(fold).join("");
  if (!q) return [{ text, match: false }];
  // Testo "piegato" con, per ogni suo carattere, la posizione nel testo vero.
  const chars = [...text];
  let folded = "";
  const origin: number[] = [];
  let offset = 0;
  for (const c of chars) {
    for (const f of fold(c)) {
      folded += f;
      origin.push(offset);
    }
    offset += c.length;
  }
  const at = matchIndex(folded, q);
  if (at < 0) return [{ text, match: false }];
  const start = origin[at];
  const lastChar = origin[at + q.length - 1];
  const end = lastChar + (text.codePointAt(lastChar)! > 0xffff ? 2 : 1);
  return [
    { text: text.slice(0, start), match: false },
    { text: text.slice(start, end), match: true },
    { text: text.slice(end), match: false },
  ].filter((p) => p.text);
}
