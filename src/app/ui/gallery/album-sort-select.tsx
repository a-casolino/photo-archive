import { SortSelect } from "@/app/ui/sort-select";
import { ALBUM_SORT_COOKIE, ALBUM_SORT_LABEL, ALBUM_SORTS, type AlbumSort } from "@/lib/album-sort";

/** Menu "Ordina album": la scelta resta in un cookie (vedi SortSelect). */
export function AlbumSortSelect({ sort }: { sort: AlbumSort }) {
  return (
    <SortSelect
      className="album-sort"
      label="Ordina album"
      cookie={ALBUM_SORT_COOKIE}
      value={sort}
      options={ALBUM_SORTS.map((s) => ({ value: s, label: ALBUM_SORT_LABEL[s] }))}
    />
  );
}
