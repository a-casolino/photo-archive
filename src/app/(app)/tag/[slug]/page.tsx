import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteTagAction, renameTagAction } from "@/app/actions/tags";
import { ActionForm } from "@/app/ui/action-form";
import { albumDates } from "@/app/ui/gallery/dates";
import { Masonry, type MasonryItem } from "@/app/ui/gallery/masonry";
import { pathWith, SelectableMasonry, SelectToggle } from "@/app/ui/gallery/photo-select";
import { PhotoTrashNotice } from "@/app/ui/gallery/trash-notice";
import { PAGE_SIZE, Pager, parsePage, photoItems } from "@/app/ui/gallery/views";
import { formatCount } from "@/lib/format";
import { listAlbums, signKeys } from "@/lib/gallery";
import { displaySize } from "@/lib/gallery-rules";
import { requireOwner } from "@/lib/session";
import { countPhotosWithTag, getTag, photosWithTag } from "@/lib/tags";

export default async function TagPage({ params, searchParams }: PageProps<"/tag/[slug]">) {
  await requireOwner();
  const { slug } = await params;
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    notFound();
  }
  const tag = await getTag(decoded);
  if (!tag) notFound();
  const sp = await searchParams;
  const page = parsePage(sp.pagina);
  const selecting = sp.seleziona === "1";

  const [albums, photos, total] = await Promise.all([
    page === 1 ? listAlbums({ tagId: tag.id }) : Promise.resolve([]),
    photosWithTag(tag.id, (page - 1) * PAGE_SIZE, PAGE_SIZE),
    countPhotosWithTag(tag.id),
  ]);
  const urls = await signKeys([...albums.map((a) => a.cover_thumb), ...photos.map((p) => p.thumb_key)]);
  const base = `/tag/${encodeURIComponent(tag.slug)}`;
  const listQuery: Record<string, string> = page > 1 ? { pagina: String(page) } : {};
  const here = pathWith(base, listQuery);

  const albumTiles: MasonryItem[] = albums.map((a) => {
    const size = displaySize(a.cover_width, a.cover_height, a.cover_orientation);
    return {
      key: a.public_id,
      href: `/album/${a.public_id}`,
      src: a.cover_thumb ? (urls.get(a.cover_thumb) ?? null) : null,
      alt: a.title,
      ratio: size ? size.height / size.width : null,
      caption: {
        title: a.title,
        detail: [albumDates(a), `${formatCount(a.photo_count)} foto`].filter(Boolean).join(" · "),
      },
    };
  });

  return (
    <>
      <p>
        <Link href="/tag">← Tag</Link>
      </p>
      <h1>#{tag.name}</h1>
      <PhotoTrashNotice sp={sp} back={here} />

      {albumTiles.length > 0 && (
        <section>
          <h2>Album ({albumTiles.length})</h2>
          <Masonry items={albumTiles} />
        </section>
      )}

      {total > 0 && (
        <section>
          <div className="page-head">
            <h2>Foto ({formatCount(total)})</h2>
            <div className="page-head-actions">
              <SelectToggle selecting={selecting} href={selecting ? here : pathWith(base, { ...listQuery, seleziona: "1" })} />
            </div>
          </div>
          <SelectableMasonry
            items={photoItems(photos, urls, (pid) => `/foto/${pid}`, { badges: true })}
            selecting={selecting}
            back={here}
          />
          <Pager base={base} page={page} total={total} />
        </section>
      )}

      {albumTiles.length === 0 && total === 0 && page === 1 && (
        <p className="muted">Nessun album e nessuna foto con questo tag.</p>
      )}

      <details className="card owner-tools">
        <summary>Rinomina o elimina il tag</summary>
        <div style={{ maxWidth: 420 }}>
          <ActionForm action={renameTagAction} submitLabel="Rinomina">
            <input type="hidden" name="tagId" value={tag.id} />
            <label>
              Nome
              <input name="name" defaultValue={tag.name} required maxLength={64} />
            </label>
          </ActionForm>
          <form action={deleteTagAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="tagId" value={tag.id} />
            <button type="submit" className="link danger">
              Elimina il tag (foto e album restano)
            </button>
          </form>
        </div>
      </details>
    </>
  );
}
