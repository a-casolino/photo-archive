import Link from "next/link";
import { cookies } from "next/headers";
import { albumTreeIndex, listAlbums, ORIGIN_LABEL, signKeys, type AlbumRow } from "@/lib/gallery";
import { requireOwner } from "@/lib/session";
import { AlbumTrashedMsg, NewAlbumDialog, parentsLabel } from "@/app/ui/gallery/album-tree";
import { albumDetail, AlbumGrid, AlbumList, AlbumViewSwitch, type AlbumEntry } from "@/app/ui/gallery/album-views";
import { ALBUM_VIEW_COOKIE, parseAlbumView } from "@/app/ui/gallery/album-view-pref";
import { SearchSuggest } from "@/app/ui/search-suggest";

const ORIGINS = Object.keys(ORIGIN_LABEL) as AlbumRow["origin"][];

export default async function AlbumsPage({ searchParams }: PageProps<"/album">) {
  await requireOwner();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const origin = ORIGINS.find((o) => o === sp.origine);
  // Senza ricerca né filtro solo il primo livello; cercando, anche i sotto-album (con il percorso).
  const searching = !!(q || origin);
  const [albums, nodes] = await Promise.all([
    listAlbums({ q: q || undefined, origin, parentId: searching ? undefined : null }),
    searching ? albumTreeIndex() : Promise.resolve([]),
  ]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const urls = await signKeys(albums.map((a) => a.cover_thumb));

  const view = parseAlbumView((await cookies()).get(ALBUM_VIEW_COOKIE)?.value);

  const entries: AlbumEntry[] = albums.map((a) => ({
    key: a.public_id,
    href: `/album/${a.public_id}`,
    src: a.cover_thumb ? (urls.get(a.cover_thumb) ?? null) : null,
    title: a.title,
    path: a.parent_id ? parentsLabel(a.id, byId) : undefined,
    detail: albumDetail(a),
    origin: ORIGIN_LABEL[a.origin],
  }));

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
        <div className="page-head-actions">
          <NewAlbumDialog />
          {albums.length > 1 && (
            <Link className="button secondary" href="/album/unisci">
              Unisci album
            </Link>
          )}
          {albums.length > 0 && <AlbumViewSwitch view={view} />}
        </div>
      </div>
      <AlbumTrashedMsg sp={sp} />
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
      ) : view === "lista" ? (
        <AlbumList albums={entries} />
      ) : (
        <AlbumGrid albums={entries} />
      )}
    </>
  );
}
