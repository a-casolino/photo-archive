import Link from "next/link";
import { MergeForm, type MergeAlbum } from "@/app/ui/gallery/merge-form";
import { parentsLabel } from "@/app/ui/gallery/album-tree";
import { albumDetail } from "@/app/ui/gallery/album-views";
import { activeSharesByAlbum } from "@/lib/albums";
import { PATH_SEP } from "@/lib/album-tree-rules";
import { albumTreeIndex, listAlbums, signKeys } from "@/lib/gallery";
import { requireOwner } from "@/lib/session";

/** Unire due o più album in uno (solo proprietario). */
export default async function MergeAlbumsPage({ searchParams }: PageProps<"/album/unisci">) {
  await requireOwner();
  const sp = await searchParams;
  const [albums, shares, nodes] = await Promise.all([listAlbums(), activeSharesByAlbum(), albumTreeIndex()]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const urls = await signKeys(albums.map((a) => a.cover_thumb));
  const preset = typeof sp.in === "string" && albums.some((a) => a.public_id === sp.in) ? sp.in : null;

  const items: MergeAlbum[] = albums.map((a) => ({
    publicId: a.public_id,
    // I sotto-album con il percorso, per riconoscerli.
    title: a.parent_id ? `${parentsLabel(a.id, byId)}${PATH_SEP}${a.title}` : a.title,
    detail: albumDetail(a),
    thumb: a.cover_thumb ? (urls.get(a.cover_thumb) ?? null) : null,
    users: shares.get(a.id)?.users ?? 0,
    links: shares.get(a.id)?.links ?? 0,
  }));

  return (
    <>
      <p>
        <Link href={preset ? `/album/${preset}` : "/album"}>← {preset ? "Album" : "Tutti gli album"}</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>Unisci album</h1>
          <p className="muted">
            Spunta gli album da unire e scegli quale tenere: gli altri confluiscono in quello.
          </p>
        </div>
      </div>
      {albums.length < 2 ? (
        <p className="muted">Servono almeno due album.</p>
      ) : (
        <MergeForm albums={items} preset={preset} />
      )}
    </>
  );
}
