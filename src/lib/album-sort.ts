/*
 * Ordinamento dell'elenco album, scelto dal proprietario e ricordato in un
 * cookie del browser (come la veduta griglia/lista). L'ordine si applica in
 * memoria all'elenco già letto: nessuna query in più sul database.
 */

export const ALBUM_SORT_COOKIE = "album_ordine";

export const ALBUM_SORTS = ["recenti", "vecchi", "nome", "nome_za"] as const;
export type AlbumSort = (typeof ALBUM_SORTS)[number];

export const ALBUM_SORT_LABEL: Record<AlbumSort, string> = {
  recenti: "Data: più recenti prima",
  vecchi: "Data: meno recenti prima",
  nome: "Nome: A → Z",
  nome_za: "Nome: Z → A",
};

export function parseAlbumSort(value: string | undefined): AlbumSort {
  return ALBUM_SORTS.find((s) => s === value) ?? "recenti";
}

// Alfabetico all'italiana: maiuscole e accenti non contano, i numeri in ordine
// naturale ("Viaggio 2" prima di "Viaggio 10").
const collator = new Intl.Collator("it", { sensitivity: "base", numeric: true });

/**
 * Restituisce una copia ordinata. Per data vale la prima foto dell'album
 * (sotto-album compresi); gli album senza data vanno sempre in fondo e a
 * parità di data decide il nome.
 */
export function sortAlbums<T extends { title: string; date_from: Date | null }>(albums: T[], sort: AlbumSort): T[] {
  const byName = (a: T, b: T) => collator.compare(a.title, b.title);
  const out = [...albums];
  if (sort === "nome") return out.sort(byName);
  if (sort === "nome_za") return out.sort((a, b) => byName(b, a));
  const dir = sort === "vecchi" ? 1 : -1;
  return out.sort((a, b) => {
    if (!a.date_from || !b.date_from) {
      if (a.date_from) return -1;
      if (b.date_from) return 1;
      return byName(a, b);
    }
    return dir * (a.date_from.getTime() - b.date_from.getTime()) || byName(a, b);
  });
}
