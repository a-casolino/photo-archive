/*
 * Collegamento per nome: export senza dati della fotocamera → CR2.
 *
 * Alcuni export di Lightroom arrivano da Google Foto senza EXIF della
 * fotocamera (l'import li considera "telefono") e con la data dell'export o
 * del caricamento invece di quella dello scatto. Il nome però è quello del
 * CR2 (ADV_1626.jpg ↔ ADV_1626.CR2).
 *
 * Misurato sull'archivio il 2026-11-16: la data dell'export è sempre dopo
 * quella del CR2; 977 casi su 1.013 stanno entro 2 giorni, poi c'è un vuoto
 * netto (nessuno tra 2 e 7 giorni) e 36 casi sparsi su mesi o anni.
 * Regola decisa con Antonio: stesso nome ed export da 0 a 2 giorni dopo il
 * CR2 → collegamento automatico da confermare; il resto con lo stesso nome →
 * "possibili", da scegliere a mano.
 */

/** Finestra in cui l'export può seguire il CR2 per il collegamento automatico. */
export const NAME_MATCH_WINDOW_MS = 48 * 3600 * 1000;

/** Quanti CR2 possibili mostrare al massimo per un export (i più vicini nel tempo). */
export const MAX_POSSIBLE = 4;

const SUFFIX = /(?:[-_ ]?(?:edit(?:ed)?|modificat[oa]|copia|copy)|\s?\(\d+\))+$/i;

/**
 * Nome senza estensione, in minuscolo, senza i suffissi che aggiungono
 * Lightroom, Google Foto o le copie ("-edit", "-modificato", " (1)").
 */
export function nameStem(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return base.replace(SUFFIX, "").trim().toLowerCase();
}

export type NamedPhoto = { id: number; name: string; taken: Date | null };

export type NameMatches = {
  /** Un solo CR2 nella finestra: collegamento automatico, da confermare. */
  auto: { exportId: number; rawId: number }[];
  /** Stesso nome ma fuori finestra, o più CR2 nella finestra: si sceglie a mano. */
  possible: { exportId: number; rawIds: number[] }[];
};

/** Collega gli export ai CR2 con lo stesso nome (vedi la regola sopra). */
export function matchByName(exports: NamedPhoto[], raws: NamedPhoto[]): NameMatches {
  const byStem = new Map<string, NamedPhoto[]>();
  for (const r of raws) {
    const k = nameStem(r.name);
    if (!k) continue;
    const list = byStem.get(k);
    if (list) list.push(r);
    else byStem.set(k, [r]);
  }

  const out: NameMatches = { auto: [], possible: [] };
  for (const e of exports) {
    const same = byStem.get(nameStem(e.name));
    if (!same?.length) continue;
    const te = e.taken?.getTime();
    const inWindow =
      te === undefined
        ? []
        : same.filter((r) => {
            const tr = r.taken?.getTime();
            return tr !== undefined && te - tr >= 0 && te - tr <= NAME_MATCH_WINDOW_MS;
          });
    if (inWindow.length === 1) {
      out.auto.push({ exportId: e.id, rawId: inWindow[0].id });
      continue;
    }
    const pool = inWindow.length > 1 ? inWindow : same;
    const distance = (r: NamedPhoto) =>
      te === undefined || !r.taken ? Number.MAX_SAFE_INTEGER : Math.abs(te - r.taken.getTime());
    const nearest = [...pool].sort((a, b) => distance(a) - distance(b) || a.id - b.id).slice(0, MAX_POSSIBLE);
    out.possible.push({ exportId: e.id, rawIds: nearest.map((r) => r.id) });
  }
  return out;
}

/** "export 14 ore dopo", "export 3 giorni prima": per la pagina Collegamenti. */
export function exportGapLabel(exportTaken: Date | null, rawTaken: Date | null): string | null {
  if (!exportTaken || !rawTaken) return null;
  const diff = exportTaken.getTime() - rawTaken.getTime();
  const hours = Math.round(Math.abs(diff) / 3600_000);
  const when = diff >= 0 ? "dopo" : "prima";
  if (hours < 1) return "export alla stessa ora";
  if (hours < 48) return `export ${hours} ${hours === 1 ? "ora" : "ore"} ${when}`;
  const days = Math.round(hours / 24);
  if (days < 365) return `export ${days} giorni ${when}`;
  const years = Math.round(days / 365);
  return `export ${years} ${years === 1 ? "anno" : "anni"} ${when}`;
}
