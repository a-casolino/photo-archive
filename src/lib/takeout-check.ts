/*
 * Verifica di un import da Google Takeout (richiesta di Antonio del
 * 2026-11-12, prima di cancellare gli zip da Drive): per ogni album degli zip
 * si confrontano le foto attese con quelle dell'album nell'archivio.
 *
 * Qui solo regole pure e tipi del resoconto: la lettura degli zip e del
 * database sta in scripts/drive/check.ts, la pagina in
 * /admin/import/drive/verifica/[id].
 */

/** Un file atteso negli zip (nome come sul disco della VPS, dimensione). */
export type ExpectedFile = { name: string; size: number };

/** Una foto dell'album nell'archivio. */
export type ArchivedFile = { name: string; size: number; trashed: boolean };

export type AlbumCheck = {
  ref: string; // nome della cartella nel Takeout (= albums.origin_ref)
  title: string | null; // titolo dell'album nell'archivio, se c'è
  albumState: "ok" | "assente" | "cestino";
  expected: number;
  found: number;
  trashed: number; // attese, presenti ma nel cestino
  missing: number;
  missingNames: string[]; // al massimo MAX_NAMES
  extra: number; // foto dell'album che non vengono da questi zip
  videos: number; // video dell'album negli zip (saltati di proposito)
};

export type TakeoutCheckReport = {
  zips: number;
  outsideAlbums: number; // file nelle cartelle degli anni, cestino, WhatsApp
  videos: number;
  others: number; // JSON esclusi: file non foto e non video
  expected: number;
  found: number;
  trashed: number;
  missing: number;
  albums: AlbumCheck[]; // prima quelli con problemi
  archiveOnlyAlbums: string[]; // album Google Foto nell'archivio che non sono negli zip
};

export const MAX_NAMES = 200;

/**
 * Confronta un album. Un file atteso è "trovato" se nell'album c'è una foto
 * attiva con lo stesso nome e la stessa dimensione; altrimenti, se c'è nel
 * cestino, è "nel cestino". Chi resta si cerca per sola dimensione tra le foto
 * attive non ancora abbinate: una foto identica a una già nell'archivio (stesso
 * contenuto, nome diverso) non viene ricaricata, si aggiunge all'album quella
 * che c'era.
 */
export function compareAlbum(
  expected: readonly ExpectedFile[],
  archived: readonly ArchivedFile[],
): Pick<AlbumCheck, "expected" | "found" | "trashed" | "missing" | "missingNames" | "extra"> {
  const key = (f: { name: string; size: number }) => `${f.size}\u0000${f.name}`;
  const pool = new Map<string, ArchivedFile[]>();
  for (const a of archived) {
    const list = pool.get(key(a));
    if (list) list.push(a);
    else pool.set(key(a), [a]);
  }
  const take = (k: string, trashed: boolean): boolean => {
    const list = pool.get(k);
    const i = list?.findIndex((a) => a.trashed === trashed) ?? -1;
    if (!list || i < 0) return false;
    list.splice(i, 1);
    return true;
  };

  let found = 0;
  let trashed = 0;
  const rest: ExpectedFile[] = [];
  for (const e of expected) {
    if (take(key(e), false)) found++;
    else if (take(key(e), true)) trashed++;
    else rest.push(e);
  }

  // Abbinamento per sola dimensione tra le foto attive rimaste.
  const bySize = new Map<number, number>();
  for (const list of pool.values()) {
    for (const a of list) if (!a.trashed) bySize.set(a.size, (bySize.get(a.size) ?? 0) + 1);
  }
  const missing: ExpectedFile[] = [];
  for (const e of rest) {
    const n = bySize.get(e.size) ?? 0;
    if (n > 0) {
      bySize.set(e.size, n - 1);
      found++;
    } else {
      missing.push(e);
    }
  }
  let extra = 0;
  for (const n of bySize.values()) extra += n;

  return {
    expected: expected.length,
    found,
    trashed,
    missing: missing.length,
    missingNames: missing.slice(0, MAX_NAMES).map((m) => m.name),
    extra,
  };
}

/** Ordine del resoconto: prima gli album con problemi (più mancanti prima), poi gli altri per nome. */
export function sortAlbumChecks(albums: AlbumCheck[]): AlbumCheck[] {
  const bad = (a: AlbumCheck) => a.missing + a.trashed + (a.albumState === "ok" ? 0 : 1);
  return [...albums].sort(
    (a, b) =>
      Number(bad(b) > 0) - Number(bad(a) > 0) ||
      b.missing + b.trashed - (a.missing + a.trashed) ||
      a.ref.localeCompare(b.ref, "it"),
  );
}
