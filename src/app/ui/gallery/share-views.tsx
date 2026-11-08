import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { formatCount } from "@/lib/format";
import { albumCounts, albumNeighbors, albumPhotos, getAlbumById, getPhoto, getPhotoById, signKeys } from "@/lib/gallery";
import { effectiveDownload, type Role } from "@/lib/roles";
import { recordShareEvent, shareCoversPhoto, type ShareRow } from "@/lib/shares";
import { albumDates } from "./dates";
import { Masonry } from "./masonry";
import { EditedFilter, PAGE_SIZE, Pager, parsePage, PhotoView, photoItems, type DownloadAccess } from "./views";

/*
 * Cosa vede chi riceve una condivisione: le stesse pagine per le
 * condivisioni protette (/condivisi/<id>, dopo il login) e per i link
 * liberi (/l/<token>). `role` è null per i link liberi.
 */

type Ctx = {
  share: ShareRow;
  base: string; // "/condivisi/<id>" oppure "/l/<token>"
  role: Role | null;
  userId: number | null;
  access: DownloadAccess;
  searchParams: Record<string, string | string[] | undefined>;
};

async function clientIp(): Promise<string | null> {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/** Pagina iniziale della condivisione: l'album o la foto. Registra la vista. */
export async function ShareHome(ctx: Ctx) {
  const { share, base, role } = ctx;
  if (role !== "owner") await recordShareEvent(share, "view", { userId: ctx.userId, ip: await clientIp() });

  if (share.target_type === "photo") {
    return <SharedPhoto {...ctx} photoPid={null} />;
  }

  const album = share.album_id ? await getAlbumById(share.album_id) : null;
  if (!album) notFound();
  const onlyEdited = ctx.searchParams.solo === "regolazioni";
  const page = parsePage(ctx.searchParams.pagina);
  const [counts, photos] = await Promise.all([
    albumCounts(album.id),
    albumPhotos(album.id, { onlyEdited, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }),
  ]);
  const urls = await signKeys(photos.map((p) => p.thumb_key));
  const suffix = onlyEdited ? "?solo=regolazioni" : "";
  const items = photoItems(photos, urls, (pid) => `${base}/foto/${pid}${suffix}`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{album.title}</h1>
          <p className="muted">
            {[albumDates(album), `${formatCount(counts.total)} foto`].filter(Boolean).join(" · ")}
          </p>
          {album.description && <p>{album.description}</p>}
          {share.message && <p className="share-note">{share.message}</p>}
        </div>
        <EditedFilter base={base} onlyEdited={onlyEdited} total={counts.total} edited={counts.edited} />
      </div>
      {photos.length === 0 ? <p className="muted">Non ci sono foto.</p> : <Masonry items={items} />}
      <Pager
        base={base}
        page={page}
        total={onlyEdited ? counts.edited : counts.total}
        query={onlyEdited ? "solo=regolazioni" : undefined}
      />
    </>
  );
}

/** Una foto della condivisione (photoPid null = la foto condivisa da sola). */
export async function SharedPhoto(ctx: Ctx & { photoPid: string | null }) {
  const { share, base, role } = ctx;
  let photo;
  if (ctx.photoPid === null) {
    if (share.target_type !== "photo" || !share.photo_id) notFound();
    photo = await getPhotoById(share.photo_id);
  } else {
    photo = await getPhoto(ctx.photoPid);
  }
  if (!photo || !(await shareCoversPhoto(share, photo.id))) notFound();

  const onlyEdited = ctx.searchParams.solo === "regolazioni";
  const suffix = onlyEdited ? "?solo=regolazioni" : "";
  const neighbors =
    share.target_type === "album" && share.album_id ? await albumNeighbors(share.album_id, photo.id, onlyEdited) : null;
  const urls = await signKeys([photo.preview_key]);
  const href = (pid: string | null) => (pid ? `${base}/foto/${pid}${suffix}` : null);
  const album = share.target_type === "album" && share.album_id ? await getAlbumById(share.album_id) : null;

  return (
    <PhotoView
      photo={photo}
      previewUrl={photo.preview_key ? (urls.get(photo.preview_key) ?? null) : null}
      nav={{
        prev: href(neighbors?.prev ?? null),
        next: href(neighbors?.next ?? null),
        up: album ? `${base}${suffix}` : null,
        upLabel: album?.title,
        position: neighbors ? `${neighbors.index} di ${neighbors.total}` : undefined,
      }}
      level={effectiveDownload(share.allow_download, role)}
      access={ctx.access}
      showPrivate={role === "owner"}
    >
      {share.target_type === "photo" && share.message && <p className="share-note">{share.message}</p>}
    </PhotoView>
  );
}
