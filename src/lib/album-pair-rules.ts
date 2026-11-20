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

import { type Hash, PIXEL_AUTO_MAX, PIXEL_MARGIN, hamming, parseHash } from "./phash-rules";

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

/**
 * Fotocamere uguali a meno del numero di serie (2026-11-20): Google Foto toglie
 * il SerialNumber, quindi la stessa Lumix diventa due righe di `cameras` (con e
 * senza seriale) e lo stesso scatto non si riconosceva più. Ogni id va sul più
 * piccolo con la stessa marca e lo stesso modello.
 */
export function cameraGroups(cameras: { id: number; make: string; model: string }[]): Map<number, number> {
  const first = new Map<string, number>();
  for (const c of cameras) {
    const k = `${c.make.trim().toLowerCase()}|${c.model.trim().toLowerCase()}`;
    const id = Number(c.id);
    const seen = first.get(k);
    if (seen === undefined || id < seen) first.set(k, id);
  }
  const out = new Map<number, number>();
  for (const c of cameras) {
    out.set(Number(c.id), first.get(`${c.make.trim().toLowerCase()}|${c.model.trim().toLowerCase()}`)!);
  }
  return out;
}

/**
 * Indice delle impronte visive per trovare la foto più simile senza
 * confrontarle tutte: 6 bit diversi su 8 byte lasciano almeno 2 byte uguali,
 * quindi ogni foto entro PIXEL_AUTO_MAX condivide almeno un byte nella stessa
 * posizione.
 */
export class HashIndex<T extends { id: number; hash: Hash }> {
  private buckets: Map<number, T[]>[] = Array.from({ length: 8 }, () => new Map());

  add(item: T): void {
    for (let i = 0; i < 8; i++) {
      const b = byteAt(item.hash, i);
      const list = this.buckets[i].get(b);
      if (list) list.push(item);
      else this.buckets[i].set(b, [item]);
    }
  }

  /** La foto più simile entro PIXEL_AUTO_MAX, se la seconda è lontana almeno PIXEL_MARGIN in più. */
  nearest(hash: Hash): T | null {
    const seen = new Set<number>();
    let best: T | null = null;
    let bestD = 65, secondD = 65;
    for (let i = 0; i < 8; i++) {
      for (const c of this.buckets[i].get(byteAt(hash, i)) ?? []) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        const d = hamming(hash, c.hash);
        if (d < bestD) {
          secondD = bestD;
          bestD = d;
          best = c;
        } else if (d < secondD) {
          secondD = d;
        }
      }
    }
    return best && bestD <= PIXEL_AUTO_MAX && secondD - bestD >= PIXEL_MARGIN ? best : null;
  }
}

function byteAt(h: Hash, i: number): number {
  return i < 4 ? (h.hi >>> (24 - 8 * i)) & 0xff : (h.lo >>> (24 - 8 * (i - 4))) & 0xff;
}

export function hashOf(hex: string | null | undefined): Hash | null {
  return hex && /^[0-9a-f]{16}$/i.test(hex) ? parseHash(hex) : null;
}

type SectionPhoto = {
  id: number;
  kind: string;
  camera_id: number | null;
  taken_at: Date | null;
  raw_id: number | null;
  phash?: string | null;
};

/**
 * Cosa fare delle foto di una cartella che si unisce all'album Google:
 *  - `behind`: stanno dietro a un export dell'album (il CR2 collegato, lo
 *    stesso scatto, o la stessa immagine per impronta visiva, più il JPEG
 *    della fotocamera accanto a un CR2 che sta dietro). Non entrano
 *    nell'album: si aprono dal link all'originale dell'export.
 *  - `extra`: gli altri scatti, in fondo all'album ("Altri scatti").
 *  - `links`: export dell'album ancora senza originale che nella cartella
 *    hanno un solo originale: il CR2 dello stesso scatto, altrimenti il file
 *    della cartella dello stesso scatto o con la stessa immagine (es. JPEG
 *    della Lumix senza CR2, 2026-11-20: la copia di Google Foto è spesso
 *    ritagliata o regolata, quindi resta in primo piano e si collega al file
 *    della fotocamera invece di sostituirlo).
 * Quelle già nell'album restano come sono.
 */
export function folderSections(
  album: SectionPhoto[],
  folder: SectionPhoto[],
): { behind: number[]; extra: number[]; links: { exportId: number; rawId: number }[] } {
  const ids = new Set(album.map((p) => Number(p.id)));
  const raws = new Set(album.flatMap((p) => (p.raw_id ? [Number(p.raw_id)] : [])));
  const shots = new Set(album.map((p) => shotKey(p.camera_id, p.taken_at)).filter((k): k is string => !!k));

  const candidates: SectionPhoto[] = [];
  const seen = new Set<number>();
  for (const p of folder) {
    const id = Number(p.id);
    if (ids.has(id) || seen.has(id)) continue;
    seen.add(id);
    candidates.push(p);
  }
  const byShot = new Map<string, SectionPhoto[]>();
  const rawsOfShot = new Map<string, number[]>();
  const index = new HashIndex<{ id: number; hash: Hash; photo: SectionPhoto }>();
  for (const p of candidates) {
    const k = shotKey(p.camera_id, p.taken_at);
    if (k) {
      byShot.set(k, [...(byShot.get(k) ?? []), p]);
      if (p.kind === "raw") rawsOfShot.set(k, [...(rawsOfShot.get(k) ?? []), Number(p.id)]);
    }
    const h = hashOf(p.phash);
    if (h) index.add({ id: Number(p.id), hash: h, photo: p });
  }

  /** L'originale di un file della cartella: il suo CR2 collegato, il CR2 dello stesso scatto, o lui. */
  const originalOf = (p: SectionPhoto): number => {
    if (p.kind === "raw") return Number(p.id);
    if (p.raw_id) return Number(p.raw_id);
    const k = shotKey(p.camera_id, p.taken_at);
    const r = k ? rawsOfShot.get(k) : undefined;
    return r?.length === 1 ? r[0] : Number(p.id);
  };

  const matched = new Set<number>();
  const links: { exportId: number; rawId: number }[] = [];
  for (const e of album) {
    if (e.kind === "raw") continue;
    const k = shotKey(e.camera_id, e.taken_at);
    let twin: SectionPhoto | undefined;
    const r = k ? rawsOfShot.get(k) : undefined;
    if (r?.length === 1) twin = candidates.find((p) => Number(p.id) === r[0]);
    if (!twin && k && !r?.length) {
      const same = byShot.get(k) ?? [];
      if (same.length === 1) twin = same[0];
    }
    if (!twin && !k) {
      const h = hashOf(e.phash);
      twin = h ? index.nearest(h)?.photo : undefined;
    }
    if (!twin) continue;
    matched.add(Number(twin.id));
    if (e.raw_id) continue;
    const original = originalOf(twin);
    if (original !== Number(e.id)) links.push({ exportId: Number(e.id), rawId: original });
  }

  const behind: number[] = [];
  const extra: number[] = [];
  const behindShots = new Set<string>();
  for (const p of candidates) {
    const id = Number(p.id);
    const k = shotKey(p.camera_id, p.taken_at);
    const isBehind =
      raws.has(id) || matched.has(id) || (k !== null && shots.has(k)) || links.some((l) => l.rawId === id);
    if (isBehind) {
      behind.push(id);
      if (k && p.kind === "raw") behindShots.add(k);
    }
  }
  // Il JPEG della fotocamera accanto a un CR2 che sta dietro (RAW+JPEG) sta dietro anche lui.
  for (const p of candidates) {
    const id = Number(p.id);
    if (behind.includes(id)) continue;
    const k = shotKey(p.camera_id, p.taken_at);
    if (k && behindShots.has(k)) behind.push(id);
    else extra.push(id);
  }
  return { behind, extra, links };
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
