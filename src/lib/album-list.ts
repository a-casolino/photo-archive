import "server-only";
import { albumDetail, type AlbumEntry } from "@/app/ui/gallery/album-views";
import { parentsLabel } from "@/app/ui/gallery/album-tree";
import { FILTER_PARAMS, hasDateFilter, parseDateFilter, type DateFilter } from "./filter-rules";
import { sortAlbums, type AlbumSort } from "./album-sort";
import { albumTreeIndex, listAlbumKeys, listAlbums, ORIGIN_LABEL, signKeys, type AlbumRow } from "./gallery";

/*
 * Elenco degli album del proprietario (pagina Album) a blocchi: il primo lo
 * disegna la pagina, gli altri arrivano da /api/album-elenco mentre si
 * scorre. Stessi filtri dall'URL e stesso ordine in entrambi i casi.
 */

/** Album del primo blocco e di ogni blocco successivo (divisibile per 2, 3, 4 e 6 colonne). */
export const ALBUM_BATCH = 48;

type Raw = string | string[] | undefined;
const ORIGINS = Object.keys(ORIGIN_LABEL) as AlbumRow["origin"][];

export type AlbumListParams = {
  q: string;
  origin: AlbumRow["origin"] | undefined;
  date: DateFilter;
  person: { id: number; public_id: string; name: string } | undefined;
  /** Ricerca o filtro attivo: anche i sotto-album (con il percorso). */
  searching: boolean;
};

export function albumListParams(
  sp: Record<string, Raw>,
  people: { id: number; public_id: string; name: string }[],
): AlbumListParams {
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const origin = ORIGINS.find((o) => o === sp.origine);
  const date = parseDateFilter(sp);
  const person = people.find((p) => p.public_id === sp[FILTER_PARAMS.person]);
  return { q, origin, date, person, searching: !!(q || origin || hasDateFilter(date) || person) };
}

/**
 * Un blocco dell'elenco nell'ordine scelto; `more` dice se dopo ce ne sono
 * altri. Si ordinano tutti gli album con una query leggera (id, titolo,
 * data) e solo per quelli del blocco si calcolano copertina, conteggi e peso.
 */
export async function albumListSlice(
  p: AlbumListParams,
  sort: AlbumSort,
  offset: number,
  limit: number = ALBUM_BATCH,
): Promise<{ entries: AlbumEntry[]; more: boolean }> {
  const keys = await listAlbumKeys({
    q: p.q || undefined,
    origin: p.origin,
    date: p.date,
    personId: p.person?.id,
    // Senza ricerca né filtro solo il primo livello.
    parentId: p.searching ? undefined : null,
  });
  const ids = sortAlbums(keys, sort)
    .slice(offset, offset + limit)
    .map((k) => k.id);
  const [rows, nodes] = await Promise.all([
    ids.length ? listAlbums({ ids }) : Promise.resolve([]),
    p.searching && ids.length ? albumTreeIndex() : Promise.resolve([]),
  ]);
  const byIdRow = new Map(rows.map((r) => [Number(r.id), r]));
  const shown = ids.map((id) => byIdRow.get(id)).filter((r) => r !== undefined);
  const more = keys.length > offset + limit;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const urls = await signKeys(shown.map((a) => a.cover_thumb));
  const entries = shown.map((a) => ({
    key: a.public_id,
    href: `/album/${a.public_id}`,
    src: a.cover_thumb ? (urls.get(a.cover_thumb) ?? null) : null,
    title: a.title,
    path: a.parent_id ? parentsLabel(a.id, byId) : undefined,
    detail: albumDetail(a, { withSize: true }),
  }));
  return { entries, more };
}
