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
