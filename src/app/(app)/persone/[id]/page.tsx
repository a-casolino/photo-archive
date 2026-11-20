import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deletePersonAction, mergePersonAction, removeFacesAction, renamePersonAction } from "@/app/actions/people";
import { ActionForm } from "@/app/ui/action-form";
import { pathWith, SelectableMasonry, SelectToggle } from "@/app/ui/gallery/photo-select";
import { PhotoTrashNotice } from "@/app/ui/gallery/trash-notice";
import { PAGE_SIZE, Pager, parsePage, photoItems } from "@/app/ui/gallery/views";
import { NavSelect } from "@/app/ui/nav-select";
import { FaceGrid } from "@/app/ui/people/faces";
import { SortSelect } from "@/app/ui/sort-select";
import { formatCount } from "@/lib/format";
import { signKeys } from "@/lib/gallery";
import { albumLinksOfPhotos, albumNodes, getPerson, listPeople, personFaces, personPhotoIds, photoCardsByIds } from "@/lib/people";
import {
  PERSON_ALBUM_PARAM,
  PERSON_PHOTO_SORT_COOKIE,
  PERSON_PHOTO_SORT_LABEL,
  PERSON_PHOTO_SORTS,
  parsePersonPhotoSort,
  personAlbumOptions,
} from "@/lib/person-photo-rules";
import { requireOwner } from "@/lib/session";
import { Button } from "@/components/ui/button";

export default async function PersonPage({ params, searchParams }: PageProps<"/persone/[id]">) {
  await requireOwner();
  const { id } = await params;
  const person = await getPerson(id);
  if (!person) notFound();
  const sp = await searchParams;
  const page = parsePage(sp.pagina);
  const selecting = sp.seleziona === "1";
  const base = `/persone/${person.public_id}`;
  const jar = await cookies();
  const sort = parsePersonPhotoSort(jar.get(PERSON_PHOTO_SORT_COOKIE)?.value);

  // Tutti gli id in ordine (query leggera), poi album, filtro e pagina in memoria:
  // le schede complete si leggono solo per le foto della pagina mostrata.
  const [allIds, faces, people, albums] = await Promise.all([
    personPhotoIds(person.id, sort),
    personFaces(person.id),
    listPeople(),
    albumNodes(),
  ]);
  const albumOptions = personAlbumOptions(await albumLinksOfPhotos(allIds), albums);
  const albumParam = typeof sp[PERSON_ALBUM_PARAM] === "string" ? sp[PERSON_ALBUM_PARAM] : undefined;
  const album = albumOptions.find((a) => a.public_id === albumParam);
  const ids = album ? allIds.filter((id) => album.photoIds.has(id)) : allIds;
  const total = ids.length;

  const filterQuery: Record<string, string> = album ? { [PERSON_ALBUM_PARAM]: album.public_id } : {};
  const listQuery: Record<string, string> = { ...filterQuery, ...(page > 1 ? { pagina: String(page) } : {}) };
  const here = pathWith(base, listQuery);

  const photos = await photoCardsByIds(ids.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
  const urls = await signKeys([...photos.map((p) => p.thumb_key), ...faces.map((f) => f.face_key)]);
  const others = people.filter((p) => p.id !== person.id);

  return (
    <>
      <p>
        <Link href="/persone" prefetch={false}>
          ← Persone
        </Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{person.name}</h1>
          <p className="muted">
            {album
              ? `${formatCount(total)} di ${formatCount(allIds.length)} foto · in «${album.label}»`
              : `${formatCount(total)} foto`}
          </p>
        </div>
        {allIds.length > 0 && (
          <div className="page-head-actions person-tools">
            {allIds.length > 1 && (
              <SortSelect
                className="album-sort"
                label="Ordina foto"
                cookie={PERSON_PHOTO_SORT_COOKIE}
                value={sort}
                options={PERSON_PHOTO_SORTS.map((s) => ({ value: s, label: PERSON_PHOTO_SORT_LABEL[s] }))}
              />
            )}
            {albumOptions.length > 0 && (
              <NavSelect
                className="person-album"
                label="Album"
                value={album?.public_id ?? ""}
                options={[
                  { value: "", label: "Tutti gli album", href: base },
                  ...albumOptions.map((a) => ({
                    value: a.public_id,
                    // Sotto-album rientrati sotto il loro album; il conteggio comprende i sotto-album.
                    label: `${"\u2003".repeat(a.depth - 1)}${a.title} (${formatCount(a.count)})`,
                    href: pathWith(base, { [PERSON_ALBUM_PARAM]: a.public_id }),
                  })),
                ]}
              />
            )}
            {total > 0 && (
              <SelectToggle selecting={selecting} href={selecting ? here : pathWith(base, { ...listQuery, seleziona: "1" })} />
            )}
          </div>
        )}
      </div>
      <PhotoTrashNotice sp={sp} back={here} />

      {total > 0 ? (
        <>
          <SelectableMasonry
            items={photoItems(photos, urls, (pid) => `/foto/${pid}`, { badges: true })}
            selecting={selecting}
            back={here}
          />
          <Pager base={base} page={page} total={total} query={new URLSearchParams(filterQuery).toString()} />
        </>
      ) : album ? (
        <p className="muted">
          Nessuna foto di {person.name} in questo album. <Link href={base}>Mostra tutte</Link>
        </p>
      ) : (
        <p className="muted">Nessuna foto confermata.</p>
      )}

      <details className="card owner-tools">
        <summary>Volti di {person.name} ({formatCount(faces.length)}{faces.length >= 120 ? "+" : ""})</summary>
        <p className="muted">Spunta i volti che non sono di {person.name} e toglili: non verranno più proposti per lei/lui.</p>
        <form action={removeFacesAction}>
          <input type="hidden" name="person" value={person.public_id} />
          <FaceGridUnchecked faces={faces} urls={urls} />
          <Button type="submit" variant="danger" size="sm" className="mt-3">
            Togli i volti spuntati
          </Button>
        </form>
      </details>

      <details className="card owner-tools">
        <summary>Rinomina, unisci o elimina</summary>
        <div style={{ maxWidth: 420 }}>
          <ActionForm action={renamePersonAction} submitLabel="Rinomina">
            <input type="hidden" name="person" value={person.public_id} />
            <label>
              Nome
              <input name="name" defaultValue={person.name} required maxLength={120} />
            </label>
          </ActionForm>

          {others.length > 0 && (
            <ActionForm action={mergePersonAction} submitLabel="Unisci">
              <input type="hidden" name="person" value={person.public_id} />
              <label>
                È la stessa persona di…
                <select name="into" required defaultValue="">
                  <option value="" disabled>
                    Scegli
                  </option>
                  {others.map((p) => (
                    <option key={p.public_id} value={p.public_id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </ActionForm>
          )}

          <form action={deletePersonAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="person" value={person.public_id} />
            <Button type="submit" variant="danger" size="sm" className="h-auto min-h-8 whitespace-normal py-1.5 text-left">
              Elimina {person.name} e i suoi volti (le foto restano)
            </Button>
          </form>
        </div>
      </details>
    </>
  );
}

/** Come FaceGrid, ma con le caselle vuote: si spuntano solo quelle da togliere. */
function FaceGridUnchecked(props: Parameters<typeof FaceGrid>[0]) {
  return <FaceGrid {...props} field="face" unchecked />;
}
