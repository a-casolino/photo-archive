import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  PencilIcon,
  Share2Icon,
  SquareCheckIcon,
  Trash2Icon,
} from "lucide-react";
import { removeFromAlbumAction } from "@/app/actions/albums";
import { setAlbumCover, updateAlbum } from "@/app/actions/shares";
import { trashAlbumAction, trashPhotosAction } from "@/app/actions/trash";
import { ActionForm } from "@/app/ui/action-form";
import {
  MoveAlbumDialog,
  NewAlbumDialog,
  parentsLabel,
  type MoveOption,
} from "@/app/ui/gallery/album-tree";
import { ALBUM_VIEW_COOKIE, parseAlbumView } from "@/app/ui/gallery/album-view-pref";
import { albumDetail, AlbumGrid, AlbumList, type AlbumEntry } from "@/app/ui/gallery/album-views";
import { albumDates } from "@/app/ui/gallery/dates";
import { Masonry } from "@/app/ui/gallery/masonry";
import { SelectBar } from "@/app/ui/gallery/select-bar";
import { AlbumTrashNotice, PhotoTrashNotice } from "@/app/ui/gallery/trash-notice";
import { ShareForm } from "@/app/ui/gallery/share-form";
import { ShareList } from "@/app/ui/gallery/share-list";
import { NamedLinkPanel } from "@/app/ui/gallery/named-link-list";
import { appUrl } from "@/lib/mail";
import { TagEditor } from "@/app/ui/gallery/tag-editor";
import { AddPhotosButton, AlbumUploader } from "@/app/ui/upload/album-uploader";
import { SlideshowButton } from "@/app/ui/slideshow/slideshow";
import { EditedFilter, PAGE_SIZE, Pager, parsePage, photoItems } from "@/app/ui/gallery/views";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { env } from "@/lib/env";
import { activeSharesByAlbum, mergedInto } from "@/lib/albums";
import { depthOf, MAX_ALBUM_DEPTH, moveTargets, PATH_SEP } from "@/lib/album-tree-rules";
import { formatCount } from "@/lib/format";
import {
  albumBranchSummary,
  albumCounts,
  albumPhotos,
  albumTreeIndex,
  getAlbum,
  getAlbumCover,
  listAlbums,
  ORIGIN_LABEL,
  signKeys,
} from "@/lib/gallery";
import { requireOwner } from "@/lib/session";
import { albumTrashPreview } from "@/lib/trash";
import { defaultLinkDays, listShares, shareableUsers } from "@/lib/shares";
import { listTags, tagsOf } from "@/lib/tags";
import { uploaderProps } from "@/lib/upload/page-props";

export default async function AlbumPage({ params, searchParams }: PageProps<"/album/[id]">) {
  await requireOwner();
  const { id } = await params;
  const sp = await searchParams;
  const album = await getAlbum(id);
  if (!album) {
    // Album unito a un altro: il vecchio indirizzo porta a quello tenuto.
    const into = await mergedInto(id);
    if (into) redirect(`/album/${into}`);
    notFound();
  }
  const merged = typeof sp.unito === "string" ? Number(sp.unito) : 0;

  const onlyEdited = sp.solo === "regolazioni";
  const selecting = sp.seleziona === "1";
  const page = parsePage(sp.pagina);
  const [counts, photos, shares, people, tags, allTags, cover, children, branch, nodes, sharedAlbums] = await Promise.all([
    albumCounts(album.id),
    albumPhotos(album.id, { onlyEdited, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }),
    listShares({ albumId: album.id }),
    shareableUsers(),
    tagsOf({ kind: "album", id: album.id }),
    listTags(),
    getAlbumCover(album),
    page === 1 ? listAlbums({ parentId: album.id }) : Promise.resolve([]),
    albumBranchSummary(album.id),
    albumTreeIndex(),
    activeSharesByAlbum(),
  ]);
  const [trashPreview, upload] = await Promise.all([albumTrashPreview(album.id), uploaderProps()]);
  const urls = await signKeys([
    ...photos.map((p) => p.thumb_key),
    ...children.map((c) => c.cover_thumb),
    cover?.thumb_key ?? null,
  ]);

  // Albero: percorso, livello, destinazioni di "Sposta in…".
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ancestors: { public_id: string; title: string }[] = [];
  for (let cur = album.parent_id; cur !== null && ancestors.length < MAX_ALBUM_DEPTH; ) {
    const n = byId.get(cur);
    if (!n) break;
    ancestors.unshift(n);
    cur = n.parent_id;
  }
  const depth = depthOf(album.id, byId);
  const canHaveChildren = depth < MAX_ALBUM_DEPTH;
  /** L'album o uno di quelli che lo contengono ha condivisioni attive. */
  const branchShared = (id: number): boolean => {
    for (let cur: number | null = id, n = 0; cur !== null && n <= MAX_ALBUM_DEPTH; n++) {
      if (sharedAlbums.has(cur)) return true;
      cur = byId.get(cur)?.parent_id ?? null;
    }
    return false;
  };
  const moveOptions: MoveOption[] = moveTargets(album.id, nodes)
    .map((id) => {
      const n = byId.get(id)!;
      const parents = parentsLabel(id, byId);
      return { publicId: n.public_id, label: parents ? `${parents}${PATH_SEP}${n.title}` : n.title, shared: branchShared(id) };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "it"));
  const inheritedShare = album.parent_id !== null && branchShared(album.parent_id);

  const view = parseAlbumView((await cookies()).get(ALBUM_VIEW_COOKIE)?.value);
  const childEntries: AlbumEntry[] = children.map((c) => ({
    key: c.public_id,
    href: `/album/${c.public_id}`,
    src: c.cover_thumb ? (urls.get(c.cover_thumb) ?? null) : null,
    title: c.title,
    detail: albumDetail(c, { withSize: true }),
  }));
  const parentHref = ancestors.length ? `/album/${ancestors[ancestors.length - 1].public_id}` : "/album";
  const base = `/album/${album.public_id}`;
  const photoQuery = new URLSearchParams({ album: album.public_id, ...(onlyEdited ? { solo: "regolazioni" } : {}) });
  const items = photoItems(photos, urls, (pid) => `/foto/${pid}?${photoQuery}`, { badges: true }).map((it) =>
    it.key === cover?.public_id ? { ...it, badge: it.badge ? `Copertina · ${it.badge}` : "Copertina" } : it,
  );
  const listQuery = new URLSearchParams({
    ...(onlyEdited ? { solo: "regolazioni" } : {}),
    ...(page > 1 ? { pagina: String(page) } : {}),
  });
  const withQuery = (extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ ...Object.fromEntries(listQuery), ...extra }).toString();
    return q ? `${base}?${q}` : base;
  };
  const activeShares = shares.filter((s) => !s.revoked_at).length;

  return (
    <>
      <nav aria-label="Percorso" className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/album" className="text-muted-foreground no-underline hover:text-foreground">
          Album
        </Link>
        {ancestors.map((a) => (
          <span key={a.public_id} className="contents">
            <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />
            <Link href={`/album/${a.public_id}`} className="truncate text-muted-foreground no-underline hover:text-foreground">
              {a.title}
            </Link>
          </span>
        ))}
        <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate text-foreground">{album.title}</span>
      </nav>
      <AlbumTrashNotice sp={sp} back={withQuery()} />
      {sp.spostato === "1" && (
        <p className="msg msg-ok card mt-4" role="status">
          Album spostato.
        </p>
      )}
      {merged > 0 && (
        <p className="msg msg-ok card mt-4" role="status">
          {merged === 1 ? "Un album è confluito" : `${merged} album sono confluiti`} in questo.
        </p>
      )}
      <div className="mt-3 mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-[1.75rem] leading-tight font-semibold md:text-[2rem]">{album.title}</h1>
          <p className="mt-1.5 mb-0 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {albumDates(branch) && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon className="size-4" aria-hidden />
                {albumDates(branch)}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <ImageIcon className="size-4" aria-hidden />
              {formatCount(counts.total)} foto
              {branch.children > 0 && branch.photos !== counts.total && ` (${formatCount(branch.photos)} con i sotto-album)`}
            </span>
            {branch.children > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <FolderOpenIcon className="size-4" aria-hidden />
                {formatCount(branch.children)} sotto-album
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <FolderIcon className="size-4" aria-hidden />
              {ORIGIN_LABEL[album.origin]}
            </span>
            {activeShares > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Share2Icon className="size-4" aria-hidden />
                {activeShares} condivision{activeShares === 1 ? "e" : "i"}
              </span>
            )}
            {inheritedShare && (
              <span className="inline-flex items-center gap-1.5">
                <Share2Icon className="size-4" aria-hidden />
                condiviso con l&apos;album che lo contiene
              </span>
            )}
          </p>
          {album.description && <p className="mt-2 mb-0 max-w-prose">{album.description}</p>}
          <TagEditor kind="album" targetId={album.public_id} tags={tags} allTags={allTags} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {branch.photos > 0 && (
            <SlideshowButton
              source={{ album: album.public_id }}
              title={album.title}
              hasSubalbums={branch.children > 0}
              onlyEdited={onlyEdited}
              castAppId={env().CAST_APP_ID ?? null}
            />
          )}
          <Dialog>
            <DialogTrigger asChild>
              <Button>
                <Share2Icon />
                Condividi
              </Button>
            </DialogTrigger>
            <DialogContent className="md:max-w-xl">
              <DialogHeader>
                <DialogTitle>Condividi «{album.title}»</DialogTitle>
                <DialogDescription>
                  Chi riceve l&apos;album vede anche i suoi sotto-album e le foto aggiunte dopo. Le foto con un export
                  di Lightroom collegato si vedono e si scaricano nella versione con le regolazioni.
                </DialogDescription>
              </DialogHeader>
              <div className="share-panel">
                <ShareForm
                  targetType="album"
                  targetId={album.public_id}
                  people={people}
                  defaultDays={defaultLinkDays()}
                />
                {shares.length > 0 && (
                  <section>
                    <h3>Condivisioni</h3>
                    <ShareList shares={shares} back={base} defaultDays={defaultLinkDays()} people={people} />
                  </section>
                )}
                <NamedLinkPanel targetType="album" targetId={album.public_id} back={base} baseUrl={appUrl("/l/")} />
              </div>
            </DialogContent>
          </Dialog>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">
                <PencilIcon />
                Modifica
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Modifica album</DialogTitle>
                <DialogDescription>Titolo, descrizione, copertina ed eliminazione.</DialogDescription>
              </DialogHeader>
              <div>
                <ActionForm action={updateAlbum} submitLabel="Salva">
                  <input type="hidden" name="albumId" value={album.public_id} />
                  <label>
                    Titolo
                    <input name="title" defaultValue={album.title} required maxLength={255} />
                  </label>
                  <label>
                    Descrizione
                    <textarea name="description" defaultValue={album.description ?? ""} rows={3} maxLength={5000} />
                  </label>
                </ActionForm>
                <div className="album-cover-info">
                  {cover?.thumb_key && urls.get(cover.thumb_key) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={urls.get(cover.thumb_key)} alt="Copertina dell'album" />
                  )}
                  <p className="muted">
                    {cover
                      ? cover.chosen
                        ? "Copertina scelta da te."
                        : "Copertina automatica: la prima foto dell'album (o dei sotto-album, se non ne ha di sue)."
                      : "Nessuna copertina: l'album è vuoto."}{" "}
                    Per cambiarla apri una foto dell&apos;album, o selezionane una, e scegli «Usa come copertina». Va
                    bene anche una foto di un sotto-album: aprila dal sotto-album e scegli «Usa come copertina di
                    “{album.title}”».
                  </p>
                </div>
                {album.origin_ref && <p className="muted origin-ref">Origine: {album.origin_ref}</p>}
                <p>
                  <Link href={`/album/unisci?in=${album.public_id}`}>Unisci altri album in questo…</Link>
                </p>
                <form action={trashAlbumAction} className="album-trash">
                  <input type="hidden" name="albumId" value={album.public_id} />
                  <input type="hidden" name="back" value={parentHref} />
                  <Button type="submit" variant="destructive">
                    <Trash2Icon />
                    Elimina album
                  </Button>
                  <p className="muted">
                    L&apos;album va nel cestino
                    {trashPreview.subalbums > 0
                      ? ` con ${trashPreview.subalbums === 1 ? "il suo sotto-album" : `i suoi ${formatCount(trashPreview.subalbums)} sotto-album`}`
                      : ""}
                    {trashPreview.only > 0
                      ? ` con ${trashPreview.only === 1 ? "la foto che sta" : `le ${formatCount(trashPreview.only)} foto che stanno`} solo ${trashPreview.subalbums > 0 ? "lì" : "qui"}`
                      : ""}
                    {trashPreview.elsewhere > 0
                      ? `; ${trashPreview.elsewhere === 1 ? "la foto che è" : `le ${formatCount(trashPreview.elsewhere)} foto che sono`} anche in altri album ${trashPreview.elsewhere === 1 ? "resta" : "restano"} lì`
                      : ""}
                    . Puoi ripristinarlo dal Cestino per {env().TRASH_RETENTION_DAYS} giorni, poi viene eliminato per
                    sempre, file compresi.
                  </p>
                </form>
              </div>
            </DialogContent>
          </Dialog>
          <AddPhotosButton />
          {canHaveChildren && <NewAlbumDialog parent={{ publicId: album.public_id, title: album.title }} />}
          <MoveAlbumDialog
            album={{ publicId: album.public_id, title: album.title }}
            options={moveOptions}
            atTop={album.parent_id === null}
          />
          {photos.length > 0 && (
            <Button asChild variant={selecting ? "secondary" : "outline"}>
              <Link href={selecting ? withQuery() : withQuery({ seleziona: "1" })} prefetch={false}>
                {selecting ? <CheckIcon /> : <SquareCheckIcon />}
                {selecting ? "Fine selezione" : "Seleziona"}
              </Link>
            </Button>
          )}
        </div>
      </div>

      <AlbumUploader
        album={{ publicId: album.public_id, title: album.title, levels: Math.max(0, MAX_ALBUM_DEPTH - depth) }}
        {...upload}
      />

      {childEntries.length > 0 && (
        <section className="subalbums" aria-label="Sotto-album">
          {view === "lista" ? <AlbumList albums={childEntries} /> : <AlbumGrid albums={childEntries} />}
        </section>
      )}

      <EditedFilter base={base} onlyEdited={onlyEdited} total={counts.total} edited={counts.edited} />

      <PhotoTrashNotice sp={sp} back={withQuery()} />

      {photos.length === 0 ? (
        <p className="muted">
          {onlyEdited
            ? "Nessuna foto con regolazioni."
            : branch.children > 0
              ? "Nessuna foto direttamente in questo album: sono nei sotto-album."
              : "L'album è vuoto."}
        </p>
      ) : selecting ? (
        <form>
          <input type="hidden" name="back" value={withQuery()} />
          <input type="hidden" name="albumId" value={album.public_id} />
          <SelectBar
            name="photo"
            single={
              <button type="submit" formAction={setAlbumCover} title="Seleziona una sola foto">
                Usa come copertina
              </button>
            }
          >
            <button
              type="submit"
              formAction={removeFromAlbumAction}
              title="Le foto escono da questo album ma restano nell'archivio e negli altri album"
            >
              Togli dall&apos;album
            </button>
            <button type="submit" className="danger" formAction={trashPhotosAction}>
              Sposta nel cestino
            </button>
          </SelectBar>
          <Masonry items={items} selectName="photo" />
        </form>
      ) : (
        <Masonry items={items} />
      )}
      <Pager
        base={base}
        page={page}
        total={onlyEdited ? counts.edited : counts.total}
        query={onlyEdited ? "solo=regolazioni" : undefined}
      />
    </>
  );
}
