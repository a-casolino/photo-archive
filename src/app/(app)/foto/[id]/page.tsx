import Link from "next/link";
import { notFound } from "next/navigation";
import { setAlbumCover } from "@/app/actions/shares";
import { trashPhotosAction } from "@/app/actions/trash";
import { ShareForm } from "@/app/ui/gallery/share-form";
import { ShareList } from "@/app/ui/gallery/share-list";
import { NamedLinkPanel } from "@/app/ui/gallery/named-link-list";
import { appUrl } from "@/lib/mail";
import { TagEditor } from "@/app/ui/gallery/tag-editor";
import { PhotoTrashNotice } from "@/app/ui/gallery/trash-notice";
import { PhotoView } from "@/app/ui/gallery/views";
import { albumNeighbors, albumsAbovePhoto, albumsOfPhoto, getAlbum, getPhoto, signKeys } from "@/lib/gallery";
import { requireOwner } from "@/lib/session";
import { defaultLinkDays, listShares, shareableUsers } from "@/lib/shares";
import { listTags, tagsOf } from "@/lib/tags";
import { peopleInPhoto, peopleOptions } from "@/lib/people";
import { photoNeighbors } from "@/lib/photos";
import { photoFilterFromParams } from "@/lib/photo-filter-params";
import { withQueryParam } from "@/lib/gallery-rules";

/** Foto appena spostata nel cestino da qui: "Annulla" ci riporta lì. */
const TRASHED_PARAM = "prima";

export default async function OwnerPhotoPage({ params, searchParams }: PageProps<"/foto/[id]">) {
  await requireOwner();
  const { id } = await params;
  const sp = await searchParams;
  const photo = await getPhoto(id);
  if (!photo) notFound();

  const onlyEdited = sp.solo === "regolazioni";
  const album = typeof sp.album === "string" ? await getAlbum(sp.album) : null;
  // Aperta dalla pagina Foto: si scorre con gli stessi filtri.
  const fromPhotos = !album && sp.da === "foto";
  const photosCtx = fromPhotos
    ? await Promise.all([peopleOptions(), listTags()]).then(([people, tags]) => photoFilterFromParams(sp, { people, tags }))
    : null;
  const neighbors = album
    ? await albumNeighbors(album.id, photo.id, onlyEdited)
    : photosCtx
      ? await photoNeighbors(photosCtx.filter, photo.id)
      : null;
  const photosList = photosCtx
    ? `/foto${Object.keys(photosCtx.query).length ? `?${new URLSearchParams(photosCtx.query)}` : ""}`
    : null;
  const [urls, albums, above, shares, people, tags, allTags, faces] = await Promise.all([
    signKeys([photo.preview_key]),
    albumsOfPhoto(photo.id),
    albumsAbovePhoto(photo.id),
    listShares({ photoId: photo.id }),
    shareableUsers(),
    tagsOf({ kind: "photo", id: photo.id }),
    listTags(),
    peopleInPhoto(photo.id),
  ]);

  const q = album
    ? `?${new URLSearchParams({ album: album.public_id, ...(onlyEdited ? { solo: "regolazioni" } : {}) })}`
    : photosCtx
      ? `?${new URLSearchParams({ da: "foto", ...photosCtx.query })}`
      : "";
  const href = (pid: string | null) => (pid ? `/foto/${pid}${q}` : null);
  const self = `/foto/${photo.public_id}`;
  // Dopo "Sposta nel cestino" si passa alla foto successiva dell'album (comodo per scremare).
  const nextAfterTrash = href(neighbors?.next ?? null) ?? href(neighbors?.prev ?? null);
  const afterTrash =
    (nextAfterTrash && withQueryParam(nextAfterTrash, TRASHED_PARAM, photo.public_id)) ??
    (album ? `/album/${album.public_id}${onlyEdited ? "?solo=regolazioni" : ""}` : (photosList ?? "/album"));
  // "Annulla" riporta alla foto appena spostata nel cestino (?prima=), se si arriva da lì.
  const trashedHere = typeof sp[TRASHED_PARAM] === "string" && /^[0-9A-Za-z]{22}$/.test(sp[TRASHED_PARAM]);
  const undoBack = trashedHere ? `/foto/${sp[TRASHED_PARAM]}${q}` : `${self}${q}`;
  // "Usa come copertina": per l'album da cui arrivi, altrimenti per ogni album che contiene la foto.
  // Anche per gli album che li contengono (sotto-album): così un album con soli sotto-album ha la sua copertina.
  const direct = albums.filter((a) => !album || a.public_id === album.public_id);
  const directIds = new Set(direct.map((a) => a.public_id));
  const seen = new Set<string>();
  const coverTargets = [
    ...direct,
    ...above.filter((u) => directIds.has(u.child_public_id) && !directIds.has(u.public_id)),
  ].filter((a) => !a.is_cover && !seen.has(a.public_id) && seen.add(a.public_id));

  return (
    <PhotoView
      photo={photo}
      previewUrl={photo.preview_key ? (urls.get(photo.preview_key) ?? null) : null}
      nav={{
        prev: href(neighbors?.prev ?? null),
        next: href(neighbors?.next ?? null),
        up: album ? `/album/${album.public_id}${onlyEdited ? "?solo=regolazioni" : ""}` : (photosList ?? "/album"),
        upLabel: album ? album.title : photosList ? "Foto" : "Album",
        position: neighbors ? `${neighbors.index} di ${neighbors.total}` : undefined,
      }}
      level="original"
      access={{}}
      showPrivate
      notice={<PhotoTrashNotice sp={sp} back={undoBack} />}
    >
      <TagEditor kind="photo" targetId={photo.public_id} tags={tags} allTags={allTags} />
      {faces.length > 0 && (
        <p className="photo-people">
          Persone:{" "}
          {faces.map((f, i) => (
            <span key={f.public_id}>
              {i > 0 && ", "}
              <Link href={`/persone/${f.public_id}`} prefetch={false}>
                {f.name}
              </Link>
            </span>
          ))}
        </p>
      )}
      <section className="photo-links">
        {photo.export_public_id && (
          <p>
            Mostrata con l&apos;export di Lightroom{" "}
            <Link href={`/foto/${photo.export_public_id}`}>{photo.export_filename}</Link>. L&apos;originale scaricabile
            resta il CR2.
          </p>
        )}
        {photo.derived_from_public_id && (
          <p>
            Export del CR2 <Link href={`/foto/${photo.derived_from_public_id}`}>originale</Link>
            {photo.match_status === "auto" && (
              <>
                {" "}
                (collegato in automatico, <Link href="/admin/import/collegamenti">da confermare</Link>)
              </>
            )}
            .
          </p>
        )}
        {albums.length > 0 && (
          <p className="muted">
            In:{" "}
            {albums.map((a, i) => (
              <span key={a.public_id}>
                {i > 0 && ", "}
                <Link href={`/album/${a.public_id}`}>{a.title}</Link>
                {a.is_cover ? " (copertina)" : ""}
              </span>
            ))}
          </p>
        )}
        {coverTargets.map((a) => (
          <form key={a.public_id} action={setAlbumCover}>
            <input type="hidden" name="albumId" value={a.public_id} />
            <input type="hidden" name="photoId" value={photo.public_id} />
            <button type="submit" className="link">
              Usa come copertina di “{a.title}”
            </button>
          </form>
        ))}
      </section>

      <details className="card owner-tools">
        <summary>
          Condividi la foto{shares.length ? ` · ${shares.filter((s) => !s.revoked_at).length} attive` : ""}
        </summary>
        <div className="share-panel">
          <ShareForm targetType="photo" targetId={photo.public_id} people={people} defaultDays={defaultLinkDays()} />
          {shares.length > 0 && (
            <section>
              <h3>Condivisioni</h3>
              <ShareList shares={shares} back={self} defaultDays={defaultLinkDays()} people={people} />
            </section>
          )}
          <NamedLinkPanel targetType="photo" targetId={photo.public_id} back={self} baseUrl={appUrl("/l/")} />
        </div>
      </details>

      <form action={trashPhotosAction} className="photo-trash">
        <input type="hidden" name="photo" value={photo.public_id} />
        <input type="hidden" name="back" value={afterTrash} />
        <button type="submit" className="link">
          Sposta nel cestino
        </button>
        <span className="muted">
          {photo.export_public_id ? " insieme all'export di Lightroom collegato" : ""} (si può ripristinare dal{" "}
          <Link href="/admin/cestino">Cestino</Link>)
        </span>
      </form>
    </PhotoView>
  );
}
