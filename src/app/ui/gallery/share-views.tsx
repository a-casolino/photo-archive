import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { ChevronRightIcon } from "lucide-react";
import { formatCount } from "@/lib/format";
import {
  albumBranchSummary,
  albumCounts,
  albumNeighbors,
  albumPath,
  albumPhotos,
  getAlbum,
  getAlbumById,
  getPhoto,
  getPhotoById,
  listAlbums,
  signKeys,
  type AlbumCrumb,
  type AlbumRow,
} from "@/lib/gallery";
import { effectiveDownload, type Role } from "@/lib/roles";
import { recordShareEvent, shareCoversPhoto, type ShareRow } from "@/lib/shares";
import { albumDetail, AlbumGrid, AlbumList, type AlbumEntry } from "./album-views";
import { ALBUM_VIEW_COOKIE, parseAlbumView } from "./album-view-pref";
import { albumDates } from "./dates";
import { Masonry } from "./masonry";
import { EditedFilter, PAGE_SIZE, Pager, parsePage, PhotoView, photoItems, type DownloadAccess } from "./views";

/*
 * Cosa vede chi riceve una condivisione: le stesse pagine per le
 * condivisioni protette (/condivisi/<id>, dopo il login) e per i link
 * liberi (/l/<token>). `role` è null per i link liberi.
 *
 * Un album condiviso comprende i suoi sotto-album: si aprono con
 * ?album=<public_id> sulla stessa pagina, solo se stanno nel ramo
 * dell'album condiviso. Il percorso parte dall'album condiviso: chi riceve
 * non vede gli album che lo contengono.
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

  const where = await sharedAlbum(share, ctx.searchParams.album);
  if (!where) notFound();
  const { album, path } = where;
  const onlyEdited = ctx.searchParams.solo === "regolazioni";
  const page = parsePage(ctx.searchParams.pagina);
  const albumQ: Record<string, string> = album.id === share.album_id ? {} : { album: album.public_id };
  const here = withQuery(base, albumQ);
  const [counts, photos, children, branch] = await Promise.all([
    albumCounts(album.id),
    albumPhotos(album.id, { onlyEdited, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }),
    page === 1 && !onlyEdited ? listAlbums({ parentId: album.id }) : Promise.resolve([]),
    albumBranchSummary(album.id),
  ]);
  const urls = await signKeys([...photos.map((p) => p.thumb_key), ...children.map((c) => c.cover_thumb)]);
  const photoQ: Record<string, string> = { ...albumQ, ...(onlyEdited ? { solo: "regolazioni" } : {}) };
  const items = photoItems(photos, urls, (pid) => withQuery(`${base}/foto/${pid}`, photoQ));
  const view = parseAlbumView((await cookies()).get(ALBUM_VIEW_COOKIE)?.value);
  const childEntries: AlbumEntry[] = children.map((c) => ({
    key: c.public_id,
    href: withQuery(base, { album: c.public_id }),
    src: c.cover_thumb ? (urls.get(c.cover_thumb) ?? null) : null,
    title: c.title,
    detail: albumDetail(c),
  }));
  const pagerQuery = new URLSearchParams(photoQ).toString();

  return (
    <>
      {path.length > 1 && <SharedPath base={base} path={path} rootId={share.album_id!} />}
      <div className="page-head">
        <div>
          <h1>{album.title}</h1>
          <p className="muted">
            {[
              albumDates(branch),
              `${formatCount(counts.total)} foto`,
              branch.children > 0 ? `${formatCount(branch.children)} sotto-album` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {album.description && <p>{album.description}</p>}
          {share.message && album.id === share.album_id && <p className="share-note">{share.message}</p>}
        </div>
        <EditedFilter base={here} onlyEdited={onlyEdited} total={counts.total} edited={counts.edited} />
      </div>
      {childEntries.length > 0 && (
        <section className="subalbums" aria-label="Sotto-album">
          {view === "lista" ? <AlbumList albums={childEntries} /> : <AlbumGrid albums={childEntries} />}
        </section>
      )}
      {photos.length === 0 ? (
        childEntries.length > 0 ? null : <p className="muted">Non ci sono foto.</p>
      ) : (
        <Masonry items={items} />
      )}
      <Pager
        base={base}
        page={page}
        total={onlyEdited ? counts.edited : counts.total}
        query={pagerQuery || undefined}
      />
    </>
  );
}

function withQuery(path: string, q: Record<string, string>): string {
  const s = new URLSearchParams(q).toString();
  return s ? `${path}?${s}` : path;
}

/**
 * L'album da mostrare: quello condiviso, o un suo sotto-album (?album=…)
 * se sta davvero nel suo ramo. Con il percorso dall'album condiviso.
 */
async function sharedAlbum(
  share: ShareRow,
  param: string | string[] | undefined,
): Promise<{ album: AlbumRow; path: AlbumCrumb[] } | null> {
  if (share.target_type !== "album" || !share.album_id) return null;
  const root = await getAlbumById(share.album_id);
  if (!root) return null;
  if (typeof param !== "string" || param === root.public_id) return { album: root, path: [root] };
  const album = await getAlbum(param);
  if (!album) return null;
  const path = await albumPath(album.id, root.id);
  if (path[0]?.id !== root.id) return null;
  return { album, path };
}

/** Percorso dentro la condivisione: dall'album condiviso al sotto-album aperto. */
function SharedPath({ base, path, rootId }: { base: string; path: AlbumCrumb[]; rootId: number }) {
  return (
    <nav aria-label="Percorso" className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground">
      {path.map((a, i) => (
        <span key={a.public_id} className="contents">
          {i > 0 && <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />}
          {i === path.length - 1 ? (
            <span className="truncate text-foreground">{a.title}</span>
          ) : (
            <Link
              href={a.id === rootId ? base : withQuery(base, { album: a.public_id })}
              className="truncate text-muted-foreground no-underline hover:text-foreground"
            >
              {a.title}
            </Link>
          )}
        </span>
      ))}
    </nav>
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

  // Navigazione nell'album (o sotto-album) da cui si è arrivati.
  const where = share.target_type === "album" ? await sharedAlbum(share, ctx.searchParams.album) : null;
  const onlyEdited = ctx.searchParams.solo === "regolazioni";
  const albumQ: Record<string, string> =
    where && where.album.id !== share.album_id ? { album: where.album.public_id } : {};
  const q: Record<string, string> = { ...albumQ, ...(onlyEdited ? { solo: "regolazioni" } : {}) };
  const neighbors = where ? await albumNeighbors(where.album.id, photo.id, onlyEdited) : null;
  const urls = await signKeys([photo.preview_key]);
  const href = (pid: string | null) => (pid ? withQuery(`${base}/foto/${pid}`, q) : null);
  const album = where?.album ?? null;

  return (
    <PhotoView
      photo={photo}
      previewUrl={photo.preview_key ? (urls.get(photo.preview_key) ?? null) : null}
      nav={{
        prev: href(neighbors?.prev ?? null),
        next: href(neighbors?.next ?? null),
        up: album ? withQuery(base, q) : null,
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
