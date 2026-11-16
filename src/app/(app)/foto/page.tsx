import Link from "next/link";
import { FilterBar } from "@/app/ui/gallery/filter-bar";
import { DateSelects, PersonSelect } from "@/app/ui/gallery/filters";
import { pathWith, SelectableMasonry, SelectToggle } from "@/app/ui/gallery/photo-select";
import { PhotoTrashNotice } from "@/app/ui/gallery/trash-notice";
import { GRID_BATCH } from "@/lib/grid-rules";
import { photoTiles } from "@/lib/photo-grid";
import { dateFilterLabel, FILTER_PARAMS } from "@/lib/filter-rules";
import { formatCount } from "@/lib/format";
import { ORIGIN_LABEL } from "@/lib/gallery";
import { peopleOptions } from "@/lib/people";
import { countPhotos, photoYears } from "@/lib/photos";
import { photoFilterFromParams } from "@/lib/photo-filter-params";
import { requireOwner } from "@/lib/session";
import { listTags } from "@/lib/tags";

const ORIGINS = Object.keys(ORIGIN_LABEL) as (keyof typeof ORIGIN_LABEL)[];

/** Tutte le foto dell'archivio, dalla più recente, con i filtri. Solo proprietario. */
export default async function PhotosPage({ searchParams }: PageProps<"/foto">) {
  await requireOwner();
  const sp = await searchParams;
  const [years, peopleList, tags] = await Promise.all([photoYears(), peopleOptions(), listTags()]);
  const { filter, query, active } = photoFilterFromParams(sp, { people: peopleList, tags });

  // Solo il primo blocco: gli altri arrivano mentre si scorre (GrowingGrid).
  const [items, total] = await Promise.all([photoTiles(filter, query, 0, GRID_BATCH), countPhotos(filter)]);
  const selecting = sp.seleziona === "1";
  // Questa pagina con i filtri, senza selezione né messaggi.
  const listQuery = query;
  const here = pathWith("/foto", listQuery);
  const dateLabel = dateFilterLabel(filter.date ?? {});
  const tagSlug = tags.find((t) => t.id === filter.tagId)?.slug;
  // Filtri attivi in parole, per il riepilogo sul telefono (la ricerca si vede già nel campo).
  const activeLabels = [
    dateLabel,
    tagSlug && `#${tags.find((t) => t.slug === tagSlug)?.name}`,
    filter.origin && ORIGIN_LABEL[filter.origin],
    filter.personId && peopleList.find((p) => p.id === filter.personId)?.name,
    filter.onlyEdited && "Con regolazioni",
  ].filter((x): x is string => !!x);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Foto</h1>
          <p className="muted">
            {formatCount(total)} foto{dateLabel ? ` · ${dateLabel}` : ""}
          </p>
        </div>
        <FilterBar
          active={activeLabels}
          resetHref={active ? "/foto" : undefined}
          search={
            <input
              type="search"
              name={FILTER_PARAMS.q}
              defaultValue={filter.q ?? ""}
              placeholder="Cerca foto, tag, album"
              aria-label="Cerca"
              maxLength={100}
            />
          }
        >
          <DateSelects value={filter.date ?? {}} years={years} />
          {tags.length > 0 && (
            <select name={FILTER_PARAMS.tag} defaultValue={tagSlug ?? ""} aria-label="Tag">
              <option value="">Tutti i tag</option>
              {tags.map((t) => (
                <option key={t.id} value={t.slug}>
                  #{t.name}
                </option>
              ))}
            </select>
          )}
          <select name={FILTER_PARAMS.origin} defaultValue={filter.origin ?? ""} aria-label="Origine">
            <option value="">Tutte le origini</option>
            {ORIGINS.map((o) => (
              <option key={o} value={o}>
                {ORIGIN_LABEL[o]}
              </option>
            ))}
          </select>
          <PersonSelect value={query[FILTER_PARAMS.person]} people={peopleList} />
          <label className="filter-check">
            <input
              type="checkbox"
              name={FILTER_PARAMS.edited}
              value="regolazioni"
              defaultChecked={filter.onlyEdited}
            />
            Solo con regolazioni
          </label>
        </FilterBar>
        {items.length > 0 && (
          <div className="page-head-actions">
            <SelectToggle selecting={selecting} href={selecting ? here : pathWith("/foto", { ...listQuery, seleziona: "1" })} />
          </div>
        )}
      </div>

      <PhotoTrashNotice sp={sp} back={here} />

      {items.length === 0 ? (
        <p className="muted">
          {active ? (
            <>
              Nessuna foto con questi filtri. <Link href="/foto">Mostra tutte</Link>
            </>
          ) : (
            <>
              Non ci sono ancora foto: arrivano con l&apos;<Link href="/admin/import">import</Link>.
            </>
          )}
        </p>
      ) : (
        <SelectableMasonry
          items={items}
          selecting={selecting}
          back={here}
          growing={{ total, endpoint: "/api/foto-elenco", source: query }}
        />
      )}
    </>
  );
}
