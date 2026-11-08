import Link from "next/link";
import { formatCount } from "@/lib/format";
import { listAlbums, ORIGIN_LABEL, signKeys, type AlbumRow } from "@/lib/gallery";
import { displaySize } from "@/lib/gallery-rules";
import { requireOwner } from "@/lib/session";
import { Masonry, type MasonryItem } from "@/app/ui/gallery/masonry";
import { albumDates } from "@/app/ui/gallery/dates";
import { SearchSuggest } from "@/app/ui/search-suggest";

const ORIGINS = Object.keys(ORIGIN_LABEL) as AlbumRow["origin"][];

export default async function AlbumsPage({ searchParams }: PageProps<"/album">) {
  await requireOwner();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const origin = ORIGINS.find((o) => o === sp.origine);
  const albums = await listAlbums({ q: q || undefined, origin });
  const urls = await signKeys(albums.map((a) => a.cover_thumb));

  const items: MasonryItem[] = albums.map((a) => {
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
      <div className="page-head">
        <h1>Album</h1>
        <form className="album-search" role="search">
          <SearchSuggest name="q" defaultValue={q} placeholder="Cerca album, tag o persone" label="Cerca" />
          <select name="origine" defaultValue={origin ?? ""} aria-label="Origine">
            <option value="">Tutte le origini</option>
            {ORIGINS.map((o) => (
              <option key={o} value={o}>
                {ORIGIN_LABEL[o]}
              </option>
            ))}
          </select>
          <button type="submit">Filtra</button>
        </form>
        {albums.length > 1 && (
          <Link className="button secondary" href="/album/unisci">
            Unisci album
          </Link>
        )}
      </div>
      {albums.length === 0 ? (
        <p className="muted">
          {q || origin ? (
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
      ) : (
        <Masonry items={items} />
      )}
    </>
  );
}
