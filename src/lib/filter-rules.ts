/*
 * Regole pure dei filtri di Album e Foto (niente database, usabili anche
 * nel browser): verificate dai test in tests/filter-rules.test.ts.
 *
 * La data è quella di scatto EXIF (`photos.taken_at`, ora locale della
 * fotocamera così com'è): il filtro la confronta senza conversioni di fuso.
 */

/** Filtro per data di scatto: ogni parte è facoltativa (es. "tutti gli agosti"). */
export type DateFilter = { year?: number; month?: number; day?: number };

export const MONTH_NAMES = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];

/** Nomi dei parametri nell'URL (uguali in Album e Foto). */
export const FILTER_PARAMS = {
  q: "q",
  year: "anno",
  month: "mese",
  day: "giorno",
  origin: "origine",
  tag: "tag",
  person: "persona",
  edited: "solo",
} as const;

type Raw = string | string[] | undefined;

function intIn(raw: Raw, min: number, max: number): number | undefined {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== "string" || !/^\d{1,4}$/.test(s)) return undefined;
  const n = Number(s);
  return n >= min && n <= max ? n : undefined;
}

/** Anno, mese e giorno dai parametri dell'URL; i valori non validi si ignorano. */
export function parseDateFilter(sp: Record<string, Raw>): DateFilter {
  const f: DateFilter = {};
  const year = intIn(sp[FILTER_PARAMS.year], 1800, 2999);
  const month = intIn(sp[FILTER_PARAMS.month], 1, 12);
  const day = intIn(sp[FILTER_PARAMS.day], 1, 31);
  if (year !== undefined) f.year = year;
  if (month !== undefined) f.month = month;
  if (day !== undefined) f.day = day;
  return f;
}

export function hasDateFilter(f: DateFilter): boolean {
  return f.year !== undefined || f.month !== undefined || f.day !== undefined;
}

/** Parametri dell'URL per il filtro di data (solo quelli presenti). */
export function dateFilterParams(f: DateFilter): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.year !== undefined) out[FILTER_PARAMS.year] = String(f.year);
  if (f.month !== undefined) out[FILTER_PARAMS.month] = String(f.month);
  if (f.day !== undefined) out[FILTER_PARAMS.day] = String(f.day);
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Condizioni SQL sulla colonna DATETIME `col` per il filtro di data. Con
 * l'anno si usa un intervallo [inizio, fine) che sfrutta l'indice su
 * taken_at; senza anno si confrontano MONTH() e DAYOFMONTH().
 */
export function dateFilterSql(col: string, f: DateFilter): { sql: string[]; params: (string | number)[] } {
  const sql: string[] = [];
  if (f.year !== undefined) {
    const params: (string | number)[] = [];
    let from: string;
    let to: string;
    if (f.month !== undefined && f.day !== undefined) {
      const d = new Date(Date.UTC(f.year, f.month - 1, f.day));
      // 31 febbraio e simili: nessuna foto.
      if (d.getUTCMonth() !== f.month - 1) return { sql: ["FALSE"], params: [] };
      const next = new Date(d.getTime() + 86_400_000);
      from = `${f.year}-${pad(f.month)}-${pad(f.day)} 00:00:00`;
      to = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())} 00:00:00`;
    } else if (f.month !== undefined) {
      from = `${f.year}-${pad(f.month)}-01 00:00:00`;
      to = f.month === 12 ? `${f.year + 1}-01-01 00:00:00` : `${f.year}-${pad(f.month + 1)}-01 00:00:00`;
    } else {
      from = `${f.year}-01-01 00:00:00`;
      to = `${f.year + 1}-01-01 00:00:00`;
    }
    sql.push(`${col} >= ?`, `${col} < ?`);
    params.push(from, to);
    if (f.day !== undefined && f.month === undefined) {
      sql.push(`DAYOFMONTH(${col}) = ?`);
      params.push(f.day);
    }
    return { sql, params };
  }
  const params: (string | number)[] = [];
  if (f.month !== undefined) {
    sql.push(`MONTH(${col}) = ?`);
    params.push(f.month);
  }
  if (f.day !== undefined) {
    sql.push(`DAYOFMONTH(${col}) = ?`);
    params.push(f.day);
  }
  return { sql, params };
}

/** "agosto 2014", "12 agosto 2014", "il 12 di ogni mese", "agosto (tutti gli anni)". */
export function dateFilterLabel(f: DateFilter): string {
  const month = f.month !== undefined ? MONTH_NAMES[f.month - 1] : undefined;
  if (f.year !== undefined) {
    if (month) return [f.day, month, f.year].filter((x) => x !== undefined).join(" ");
    return f.day !== undefined ? `il ${f.day} di ogni mese del ${f.year}` : String(f.year);
  }
  if (month) return f.day !== undefined ? `${f.day} ${month} (tutti gli anni)` : `${month} (tutti gli anni)`;
  return f.day !== undefined ? `il ${f.day} di ogni mese` : "";
}
