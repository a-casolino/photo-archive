/*
 * Coppie album Google ↔ cartella del disco (passo 2 della richiesta di
 * Antonio del 2026-11-16).
 *
 * Gli album di primo livello che vengono da Google Foto/Drive sono una
 * selezione esportata di un evento; gli scatti originali stanno in una
 * cartella del disco (Backup Foto › anno › giorno). Una foto dell'album
 * Google "vota" per le cartelle dove sta il suo CR2 collegato, oppure un
 * file con la stessa fotocamera e lo stesso istante (JPEG o CR2), oppure
 * lei stessa. La coppia si propone quando una cartella raccoglie almeno
 * PAIR_MIN_SHARE delle foto dell'album: un evento su due giorni riceve due
 * cartelle, una raccolta (es. "Simply Rossella", 90 cartelle) nessuna.
 * Ogni cartella va a un solo album, quello con più foto in comune.
 */

/** Quota minima delle foto dell'album che devono stare nella cartella. */
export const PAIR_MIN_SHARE = 0.2;
/** Foto in comune minime, per non proporre coppie da una foto sola. */
export const PAIR_MIN_PHOTOS = 3;
/** Sopra questa quota la coppia si può confermare in blocco. */
export const PAIR_SURE_SHARE = 0.7;

export type AlbumVotes = {
  albumId: number;
  /** Foto (non nel cestino) dell'album Google. */
  photos: number;
  /** Per ogni foto, le cartelle dove sta il suo originale. */
  folders: Iterable<number>[];
};

export type AlbumPair = { googleId: number; folderId: number; shared: number; photos: number };

/** Le coppie proposte, al più una per cartella. */
export function proposePairs(albums: AlbumVotes[]): AlbumPair[] {
  const candidates: AlbumPair[] = [];
  for (const a of albums) {
    const votes = new Map<number, number>();
    for (const f of a.folders) for (const id of new Set(f)) votes.set(id, (votes.get(id) ?? 0) + 1);
    for (const [folderId, shared] of votes) {
      if (shared >= PAIR_MIN_PHOTOS && shared >= a.photos * PAIR_MIN_SHARE) {
        candidates.push({ googleId: a.albumId, folderId, shared, photos: a.photos });
      }
    }
  }
  // Una cartella contesa va all'album con più foto in comune, poi a quello che copre di più.
  candidates.sort((x, y) => y.shared - x.shared || y.shared / y.photos - x.shared / x.photos || x.googleId - y.googleId);
  const taken = new Set<number>();
  const out: AlbumPair[] = [];
  for (const c of candidates) {
    if (taken.has(c.folderId)) continue;
    taken.add(c.folderId);
    out.push(c);
  }
  return out.sort((x, y) => x.googleId - y.googleId || y.shared - x.shared);
}

/** Chiave per riconoscere lo stesso scatto: fotocamera + istante. */
export function shotKey(cameraId: number | null, takenAt: Date | null): string | null {
  return cameraId && takenAt ? `${cameraId}|${takenAt.getTime()}` : null;
}

type SectionPhoto = { id: number; kind: string; camera_id: number | null; taken_at: Date | null; raw_id: number | null };

/**
 * Cosa fare delle foto di una cartella che si unisce all'album Google:
 *  - `behind`: stanno dietro a un export dell'album (il CR2 collegato, o lo
 *    stesso scatto: stessa fotocamera e stesso istante). Non entrano
 *    nell'album: si aprono dal link al RAW dell'export.
 *  - `extra`: gli altri scatti, in fondo all'album ("Altri scatti").
 *  - `links`: export dell'album ancora senza CR2 che hanno nella cartella un
 *    solo CR2 dello stesso scatto: si collegano.
 * Quelle già nell'album restano come sono.
 */
export function folderSections(
  album: SectionPhoto[],
  folder: SectionPhoto[],
): { behind: number[]; extra: number[]; links: { exportId: number; rawId: number }[] } {
  const ids = new Set(album.map((p) => Number(p.id)));
  const raws = new Set(album.flatMap((p) => (p.raw_id ? [Number(p.raw_id)] : [])));
  const shots = new Set(album.map((p) => shotKey(p.camera_id, p.taken_at)).filter((k): k is string => !!k));
  const out = { behind: [] as number[], extra: [] as number[], links: [] as { exportId: number; rawId: number }[] };
  const seen = new Set<number>();
  const rawsOfShot = new Map<string, number[]>();
  for (const p of folder) {
    const id = Number(p.id);
    if (ids.has(id) || seen.has(id)) continue;
    seen.add(id);
    const k = shotKey(p.camera_id, p.taken_at);
    (raws.has(id) || (k && shots.has(k)) ? out.behind : out.extra).push(id);
    if (k && p.kind === "raw") rawsOfShot.set(k, [...(rawsOfShot.get(k) ?? []), id]);
  }
  for (const e of album) {
    if (e.kind === "raw" || e.raw_id) continue;
    const k = shotKey(e.camera_id, e.taken_at);
    const r = k ? rawsOfShot.get(k) : undefined;
    if (r?.length === 1) out.links.push({ exportId: Number(e.id), rawId: r[0] });
  }
  return out;
}

/** La cartella del disco che si chiama così contiene gli anni e i giorni. */
export const BACKUP_ROOT_TITLE = /^backup foto$/i;

/**
 * Titolo di una cartella di Backup Foto portata al primo livello: la data
 * completa se la cartella comincia con mese-giorno ("07-10 compleanno catia"
 * in "2016" → "2016-07-10 compleanno catia"), altrimenti l'anno tra
 * parentesi se nel titolo non c'è già.
 */
export function promotedTitle(yearTitle: string | null, title: string): string {
  const year = yearTitle?.trim().match(/^\d{4}$/)?.[0];
  if (!year) return title;
  if (/^\d{2}-\d{2}(\b|$)/.test(title)) return `${year}-${title}`;
  if (title.includes(year)) return title;
  return `${title} (${year})`;
}

/** Titolo di una cartella anno con foto sue, fuori dai giorni. */
export function looseYearTitle(yearTitle: string): string {
  return `${yearTitle} (foto senza cartella)`;
}
