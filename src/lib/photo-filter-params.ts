import { dateFilterParams, FILTER_PARAMS, hasDateFilter, parseDateFilter } from "./filter-rules";
import type { AlbumRow } from "./gallery";
import type { PhotoFilter } from "./photos";
import { parseSearchQuery } from "./search-rules";

/*
 * Dai parametri dell'URL della pagina Foto al filtro per le query, e
 * ritorno: `query` sono i soli parametri validi, da riportare nei link
 * (paginazione, foto aperta, "torna alle foto").
 */

type Raw = string | string[] | undefined;

const ORIGINS: AlbumRow["origin"][] = ["disk_folder", "google_photos", "manual"];

function first(raw: Raw): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function photoFilterFromParams(
  sp: Record<string, Raw>,
  lookups: { people: { id: number; public_id: string }[]; tags: { id: number; slug: string }[] },
): { filter: PhotoFilter; query: Record<string, string>; active: boolean } {
  const filter: PhotoFilter = {};
  const query: Record<string, string> = {};

  const q = parseSearchQuery(first(sp[FILTER_PARAMS.q]));
  if (q) {
    filter.q = q;
    query[FILTER_PARAMS.q] = q;
  }
  const date = parseDateFilter(sp);
  if (hasDateFilter(date)) {
    filter.date = date;
    Object.assign(query, dateFilterParams(date));
  }
  const tag = lookups.tags.find((t) => t.slug === first(sp[FILTER_PARAMS.tag]));
  if (tag) {
    filter.tagId = tag.id;
    query[FILTER_PARAMS.tag] = tag.slug;
  }
  const origin = ORIGINS.find((o) => o === first(sp[FILTER_PARAMS.origin]));
  if (origin) {
    filter.origin = origin;
    query[FILTER_PARAMS.origin] = origin;
  }
  const person = lookups.people.find((p) => p.public_id === first(sp[FILTER_PARAMS.person]));
  if (person) {
    filter.personId = person.id;
    query[FILTER_PARAMS.person] = person.public_id;
  }
  if (first(sp[FILTER_PARAMS.edited]) === "regolazioni") {
    filter.onlyEdited = true;
    query[FILTER_PARAMS.edited] = "regolazioni";
  }
  return { filter, query, active: Object.keys(query).length > 0 };
}
