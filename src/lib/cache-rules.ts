/*
 * Quali voci della cache invalida una scrittura sul database.
 *
 * Ogni INSERT/UPDATE/DELETE passa da src/lib/db.ts, che guarda la tabella
 * scritta e svuota le voci con l'etichetta corrispondente:
 * - "album": elenco album, conteggi, copertine, periodi, anni e dispositivi;
 * - "volti": persone, conteggi dei volti, filtri per persona.
 * Meglio svuotare una volta di troppo che lasciare un numero sbagliato per
 * giorni: una tabella sconosciuta non svuota niente solo se non c'entra
 * con i dati in cache (sessioni, condivisioni, import, Drive...).
 */

export const CACHE_TAGS = ["album", "volti"] as const;
export type CacheTag = (typeof CACHE_TAGS)[number];

const TABLE_TAGS: Record<string, readonly CacheTag[]> = {
  photos: ["album", "volti"],
  albums: ["album"],
  album_photos: ["album"],
  album_tags: ["album"],
  tags: ["album"],
  cameras: ["album"],
  faces: ["volti"],
  people: ["volti"],
  face_rejections: ["volti"],
};

/**
 * Colonne di photos che non entrano in nessun dato in cache: aggiornarle
 * (impronte visive, luoghi) non svuota niente.
 * faces_* tocca solo i contatori dei volti.
 */
const PHOTO_COLUMNS_NONE = new Set(["phash", "place_name"]);
const PHOTO_COLUMNS_FACES = new Set(["faces_scanned_at", "faces_model"]);

const WRITE_RE = /^\s*(?:INSERT(?:\s+IGNORE)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+IGNORE)?|DELETE\s+(?:[a-z_]+\s+)?FROM)\s+`?([a-z_]+)`?/i;

/** Le etichette da svuotare dopo questa istruzione SQL (vuoto se non è una scrittura). */
export function tagsForSql(sql: string): CacheTag[] {
  const m = WRITE_RE.exec(sql);
  if (!m) return [];
  const table = m[1].toLowerCase();
  const tags = TABLE_TAGS[table];
  if (!tags) return [];
  if (table === "photos" && /^\s*UPDATE/i.test(sql)) {
    const cols = updatedColumns(sql);
    if (cols.length && cols.every((c) => PHOTO_COLUMNS_NONE.has(c))) return [];
    if (cols.length && cols.every((c) => PHOTO_COLUMNS_NONE.has(c) || PHOTO_COLUMNS_FACES.has(c))) return ["volti"];
  }
  return [...tags];
}

/**
 * Colonne assegnate nella SET di un UPDATE (anche UPDATE ... JOIN, con o
 * senza alias). Con una sottoquery nella SET, o una SET che non sa leggere,
 * restituisce [] (= considera tutte le colonne).
 */
export function updatedColumns(sql: string): string[] {
  const m = /\bSET\b([\s\S]*?)(?:\bWHERE\b|$)/i.exec(sql);
  if (!m || /\bSELECT\b/i.test(m[1])) return [];
  // Una virgola dentro una funzione (COALESCE(a, b)) non separa assegnazioni:
  // si contano solo i nomi seguiti da "=" a profondità zero.
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  const s = m[1];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  const cols: string[] = [];
  for (const part of parts) {
    const c = /^\s*(?:[a-z_]+\.)?`?([a-z_]+)`?\s*=/i.exec(part);
    if (!c) return [];
    cols.push(c[1].toLowerCase());
  }
  return cols;
}
