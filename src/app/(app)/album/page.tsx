import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cookies } from "next/headers";
import { ORIGIN_LABEL, type AlbumRow } from "@/lib/gallery";
import { ALBUM_BATCH, albumListParams, albumListSlice } from "@/lib/album-list";
import { requireOwner } from "@/lib/session";
import { NewAlbumDialog } from "@/app/ui/gallery/album-tree";
import { trashAlbumsAction } from "@/app/actions/trash";
import { pathWith, SelectToggle } from "@/app/ui/gallery/photo-select";
import { ConfirmButton, SelectBar } from "@/app/ui/gallery/select-bar";
import { AlbumTrashNotice } from "@/app/ui/gallery/trash-notice";
import { AlbumViewSwitch } from "@/app/ui/gallery/album-views";
import { AlbumEntries } from "@/app/ui/gallery/album-entries";
import { ALBUM_VIEW_COOKIE, parseAlbumView } from "@/app/ui/gallery/album-view-pref";
import { AlbumSortSelect } from "@/app/ui/gallery/album-sort-select";
import { ALBUM_SORT_COOKIE, parseAlbumSort } from "@/lib/album-sort";
import { SearchSuggest } from "@/app/ui/search-suggest";
import { FilterBar } from "@/app/ui/gallery/filter-bar";
import { DateSelects, PersonSelect } from "@/app/ui/gallery/filters";
import { dateFilterLabel } from "@/lib/filter-rules";
import { peopleOptions } from "@/lib/people";
import { photoYears } from "@/lib/photos";

const ORIGINS = Object.keys(ORIGIN_LABEL) as AlbumRow["origin"][];

export default async function AlbumsPage({ searchParams }: PageProps<"/album">) {
  await requireOwner();
  const sp = await searchParams;
  const [years, peopleList] = await Promise.all([photoYears(), peopleOptions()]);
  const params = albumListParams(sp, peopleList);
  const { q, origin, date, person, searching } = params;
  // Filtri attivi in parole, per il riepilogo sul telefono.
  const activeLabels = [dateFilterLabel(date), origin && ORIGIN_LABEL[origin], person?.name].filter(
    (x): x is string => !!x,
  );
  const jar = await cookies();
  const sort = parseAlbumSort(jar.get(ALBUM_SORT_COOKIE)?.value);
  // Solo il primo blocco, nell'ordine scelto: gli altri arrivano mentre si scorre (AlbumEntries).
  const { entries: albums, more } = await albumListSlice(params, sort, 0, ALBUM_BATCH);

  const view = parseAlbumView(jar.get(ALBUM_VIEW_COOKIE)?.value);
  const selecting = sp.seleziona === "1";
  // Questa pagina con ricerca e filtri, senza selezione né messaggi.
  const MESSAGE_PARAMS = ["seleziona", "album_cestino", "sotto_album", "album_n", "album_ripristinati"];
  const listQuery = Object.fromEntries(
    Object.entries(sp).filter(
      (e): e is [string, string] => typeof e[1] === "string" && e[1] !== "" && !MESSAGE_PARAMS.includes(e[0]),
    ),
  );
  const here = pathWith("/album", listQuery);
  const entriesProps = { initial: albums, more, query: new URLSearchParams(listQuery).toString(), batch: ALBUM_BATCH, view };

  return (
    <>
      <div className="page-head">
        <h1>Album</h1>
        <FilterBar
          active={activeLabels}
          resetHref={searching ? "/album" : undefined}
          search={<SearchSuggest name="q" defaultValue={q} placeholder="Cerca album, tag o persone" label="Cerca" />}
        >
          <DateSelects value={date} years={years} />
          <select name="origine" defaultValue={origin ?? ""} aria-label="Origine">
            <option value="">Tutte le origini</option>
            {ORIGINS.map((o) => (
              <option key={o} value={o}>
                {ORIGIN_LABEL[o]}
              </option>
            ))}
          </select>
          <PersonSelect value={person?.public_id} people={peopleList} />
        </FilterBar>
        <div className="page-head-actions">
          <NewAlbumDialog />
          {albums.length > 1 && (
            <Button asChild variant="outline">
              <Link href="/album/unisci">
                Unisci album
              </Link>
            </Button>
          )}
          {albums.length > 0 && (
            <SelectToggle selecting={selecting} href={selecting ? here : pathWith("/album", { ...listQuery, seleziona: "1" })} />
          )}
          {albums.length > 1 && <AlbumSortSelect sort={sort} />}
          {albums.length > 0 && <AlbumViewSwitch view={view} />}
        </div>
      </div>
      <AlbumTrashNotice sp={sp} back={here} />
      {albums.length === 0 ? (
        <p className="muted">
          {searching ? (
            <>
              Nessun album trovato. <Link href="/album">Mostra tutti</Link>
            </>
          ) : (
            <>
              Non ci sono ancora album: arrivano con l&apos;<Link href="/admin/import">import</Link> (ogni cartella del
              disco e ogni album di Google Foto diventa un album).
            </>
          )}
        </p>
      ) : selecting ? (
        <form>
          <input type="hidden" name="back" value={here} />
          <SelectBar name="album" masculine>
            <ConfirmButton
              formAction={trashAlbumsAction}
              label="Sposta nel cestino"
              confirmLabel="Con i sotto-album e le foto che stanno solo lì"
            />
          </SelectBar>
          <AlbumEntries {...entriesProps} selectName="album" />
        </form>
      ) : (
        <AlbumEntries {...entriesProps} />
      )}
    </>
  );
}
