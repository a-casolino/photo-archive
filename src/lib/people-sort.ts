/*
 * Ordinamento della pagina Persone, scelto dal proprietario e ricordato in un
 * cookie del browser (come l'ordine degli album). I conteggi arrivano già da
 * listPeople(): l'ordine si applica in memoria, senza altre query.
 */

export const PEOPLE_SORT_COOKIE = "persone_ordine";

export const PEOPLE_SORTS = ["nome", "foto"] as const;
export type PeopleSort = (typeof PEOPLE_SORTS)[number];

export const PEOPLE_SORT_LABEL: Record<PeopleSort, string> = {
  nome: "Nome: A → Z",
  foto: "Numero di foto",
};

export function parsePeopleSort(value: string | undefined): PeopleSort {
  return PEOPLE_SORTS.find((s) => s === value) ?? "nome";
}

// Alfabetico all'italiana: maiuscole e accenti non contano, numeri in ordine naturale.
const collator = new Intl.Collator("it", { sensitivity: "base", numeric: true });

/**
 * Restituisce una copia ordinata. "foto": prima chi compare in più foto
 * (conferme, senza il cestino); a pari numero decide il nome.
 */
export function sortPeople<T extends { name: string; photo_count: number | string }>(people: T[], sort: PeopleSort): T[] {
  const byName = (a: T, b: T) => collator.compare(a.name, b.name);
  const out = [...people];
  if (sort === "nome") return out.sort(byName);
  return out.sort((a, b) => Number(b.photo_count) - Number(a.photo_count) || byName(a, b));
}
