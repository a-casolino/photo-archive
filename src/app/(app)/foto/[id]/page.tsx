import Link from "next/link";
import { notFound } from "next/navigation";
import { setAlbumCover } from "@/app/actions/shares";
import { trashPhotosAction } from "@/app/actions/trash";
import { ShareForm } from "@/app/ui/gallery/share-form";
import { ShareList } from "@/app/ui/gallery/share-list";
import { TagEditor } from "@/app/ui/gallery/tag-editor";
import { PhotoView } from "@/app/ui/gallery/views";
import { albumNeighbors, albumsOfPhoto, getAlbum, getPhoto, signKeys } from "@/lib/gallery";
import { requireOwner } from "@/lib/session";
import { defaultLinkDays, listShares, shareableUsers } from "@/lib/shares";
import { listTags, tagsOf } from "@/lib/tags";
import { peopleInPhoto } from "@/lib/people";

export default async function OwnerPhotoPage({ params, searchParams }: PageProps<"/foto/[id]">) {
  await requireOwner();
  const { id } = await params;
  const sp = await searchParams;
  const photo = await getPhoto(id);
  if (!photo) notFound();

  const onlyEdited = sp.solo === "regolazioni";
  const album = typeof sp.album === "string" ? await getAlbum(sp.album) : null;
  const neighbors = album ? await albumNeighbors(album.id, photo.id, onlyEdited) : null;
  const [urls, albums, shares, people, tags, allTags, faces] = await Promise.all([
    signKeys([photo.preview_key]),
    albumsOfPhoto(photo.id),
    listShares({ photoId: photo.id }),
    shareableUsers(),
    tagsOf({ kind: "photo", id: photo.id }),
    listTags(),
    peopleInPhoto(photo.id),
  ]);

  const q = album ? `?${new URLSearchParams({ album: album.public_id, ...(onlyEdited ? { solo: "regolazioni" } : {}) })}` : "";
  const href = (pid: string | null) => (pid ? `/foto/${pid}${q}` : null);
  const self = `/foto/${photo.public_id}`;
  // Dopo "Sposta nel cestino" si passa alla foto successiva dell'album (comodo per scremare).
  const afterTrash =
    href(neighbors?.next ?? null) ??
    href(neighbors?.prev ?? null) ??
    (album ? `/album/${album.public_id}${onlyEdited ? "?solo=regolazioni" : ""}` : "/album");
  // "Usa come copertina": per l'album da cui arrivi, altrimenti per ogni album che contiene la foto.
  const coverTargets = albums.filter((a) => !a.is_cover && (!album || a.public_id === album.public_id));

  return (
    <PhotoView
      photo={photo}
      previewUrl={photo.preview_key ? (urls.get(photo.preview_key) ?? null) : null}
      nav={{
        prev: href(neighbors?.prev ?? null),
        next: href(neighbors?.next ?? null),
        up: album ? `/album/${album.public_id}${onlyEdited ? "?solo=regolazioni" : ""}` : "/album",
        upLabel: album ? album.title : "Album",
        position: neighbors ? `${neighbors.index} di ${neighbors.total}` : undefined,
      }}
      level="original"
      access={{}}
      showPrivate
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
