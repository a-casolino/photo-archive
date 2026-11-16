"use client";

import { AlbumGrid, AlbumList, type AlbumEntry } from "./album-views";
import type { AlbumView } from "./album-view-pref";
import { GrowingFoot } from "./growing-foot";
import { useGrowing } from "./use-growing";

/*
 * Elenco della pagina Album (griglia o lista) che arriva a blocchi mentre si
 * scorre (vedi useGrowing e /api/album-elenco): il server calcola copertine,
 * conteggi e peso solo per gli album che si vedono.
 */
export function AlbumEntries({
  initial,
  more,
  query,
  batch,
  view,
  selectName,
}: {
  initial: AlbumEntry[];
  more: boolean;
  /** Ricerca e filtri della pagina, per /api/album-elenco. */
  query: string;
  batch: number;
  view: AlbumView;
  selectName?: string;
}) {
  const g = useGrowing({ initial, endpoint: "/api/album-elenco", query, initialMore: more, batch });
  return (
    <div onClickCapture={g.remember}>
      {view === "lista" ? (
        <AlbumList albums={g.items} selectName={selectName} />
      ) : (
        <AlbumGrid albums={g.items} selectName={selectName} />
      )}
      {g.more && <GrowingFoot sentinel={g.sentinel} loading={g.loading} failed={g.failed} retry={g.retry} />}
    </div>
  );
}
