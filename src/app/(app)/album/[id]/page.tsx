import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { updateAlbum } from "@/app/actions/shares";
import { trashPhotosAction } from "@/app/actions/trash";
import { ActionForm } from "@/app/ui/action-form";
import { albumDates } from "@/app/ui/gallery/dates";
import { Masonry } from "@/app/ui/gallery/masonry";
import { SelectBar } from "@/app/ui/gallery/select-bar";
import { ShareForm } from "@/app/ui/gallery/share-form";
import { ShareList } from "@/app/ui/gallery/share-list";
import { TagEditor } from "@/app/ui/gallery/tag-editor";
import { EditedFilter, PAGE_SIZE, Pager, parsePage, photoItems } from "@/app/ui/gallery/views";
import { env } from "@/lib/env";

import { mergedInto } from "@/lib/albums";
import { formatCount } from "@/lib/format";
import { albumCounts, albumPhotos, getAlbum, getAlbumCover, ORIGIN_LABEL, signKeys } from "@/lib/gallery";
import { requireOwner } from "@/lib/session";
import { defaultLinkDays, listShares, shareableUsers } from "@/lib/shares";
import { listTags, tagsOf } from "@/lib/tags";

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
  const trashed = typeof sp.cestino === "string" && /^\d+$/.test(sp.cestino) ? Number(sp.cestino) : 0;
  const page = parsePage(sp.pagina);
  const [counts, photos, shares, people, tags, allTags, cover] = await Promise.all([
    albumCounts(album.id),
    albumPhotos(album.id, { onlyEdited, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }),
    listShares({ albumId: album.id }),
    shareableUsers(),
    tagsOf({ kind: "album", id: album.id }),
    listTags(),
    getAlbumCover(album),
  ]);
  const urls = await signKeys([...photos.map((p) => p.thumb_key), cover?.thumb_key ?? null]);
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
      <p>
        <Link href="/album">← Album</Link>
      </p>
      {merged > 0 && (
        <p className="msg msg-ok card" role="status">
          {merged === 1 ? "Un album è confluito" : `${merged} album sono confluiti`} in questo.
        </p>
      )}
      <div className="page-head">
        <div>
          <h1>{album.title}</h1>
          <p className="muted">
            {[albumDates(album), `${formatCount(counts.total)} foto`, ORIGIN_LABEL[album.origin]]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {album.description && <p>{album.description}</p>}
          <TagEditor kind="album" targetId={album.public_id} tags={tags} allTags={allTags} />
        </div>
        <div className="album-tools">
          <EditedFilter base={base} onlyEdited={onlyEdited} total={counts.total} edited={counts.edited} />
          {photos.length > 0 && (
            <Link href={selecting ? withQuery() : withQuery({ seleziona: "1" })} prefetch={false} className="button">
              {selecting ? "Fine selezione" : "Seleziona"}
            </Link>
          )}
        </div>
      </div>

      {trashed > 0 && (
        <p className="msg msg-ok" role="status">
          {trashed} foto nel <Link href="/admin/cestino">cestino</Link>: puoi ripristinarle per{" "}
          {env().TRASH_RETENTION_DAYS} giorni.
        </p>
      )}

      <details className="card owner-tools">
        <summary>
          Condividi l&apos;album{activeShares ? ` · ${activeShares} condivision${activeShares === 1 ? "e" : "i"}` : ""}
        </summary>
        <div className="owner-grid">
          <ShareForm targetType="album" targetId={album.public_id} people={people} defaultDays={defaultLinkDays()} />
          <ShareList shares={shares} back={base} defaultDays={defaultLinkDays()} people={people} />
        </div>
        <p className="muted">
          Chi riceve l&apos;album vede anche le foto aggiunte dopo. Le foto con un export di Lightroom collegato si
          vedono e si scaricano nella versione con le regolazioni.
        </p>
      </details>

      <details className="card owner-tools">
        <summary>Modifica album</summary>
        <div style={{ maxWidth: 520 }}>
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
                  : "Copertina automatica: la prima foto dell'album."
                : "Nessuna copertina: l'album è vuoto."}{" "}
              Per cambiarla apri una foto dell&apos;album e scegli «Usa come copertina».
            </p>
          </div>
          {album.origin_ref && <p className="muted origin-ref">Origine: {album.origin_ref}</p>}
          <p>
            <Link href={`/album/unisci?in=${album.public_id}`}>Unisci altri album in questo…</Link>
          </p>
        </div>
      </details>

      {photos.length === 0 ? (
        <p className="muted">{onlyEdited ? "Nessuna foto con regolazioni." : "L'album è vuoto."}</p>
      ) : selecting ? (
        <form>
          <input type="hidden" name="back" value={withQuery()} />
          <SelectBar name="photo">
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
