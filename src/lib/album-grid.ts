import "server-only";
import type { MasonryItem } from "@/app/ui/gallery/masonry";
import { markCover, photoItems } from "@/app/ui/gallery/tiles";
import { albumPhotos, signKeys, type AlbumRow } from "./gallery";

/*
 * Riquadri delle foto di un album, a blocchi: il primo lo disegna la pagina,
 * gli altri arrivano da /api/griglia mentre si scorre. Stessa query e stessi
 * link in entrambi i casi.
 */

export type AlbumGridWhere = {
  album: Pick<AlbumRow, "id">;
  /** "" per il proprietario, "/condivisi/<id>" o "/l/<token>" per le condivisioni. */
  base: string;
  /** Parametri dei link delle foto (album aperto). */
  albumQ: Record<string, string>;
  owner: boolean;
};

export async function albumTiles(
  where: AlbumGridWhere,
  opts: { onlyEdited: boolean; coverPid?: string | null; offset: number; limit: number },
): Promise<MasonryItem[]> {
  const photos = await albumPhotos(where.album.id, {
    onlyEdited: opts.onlyEdited,
    offset: opts.offset,
    limit: opts.limit,
  });
  const urls = await signKeys(photos.map((p) => p.thumb_key));
  const q = new URLSearchParams({ ...where.albumQ, ...(opts.onlyEdited ? { solo: "regolazioni" } : {}) }).toString();
  const items = photoItems(photos, urls, (pid) => `${where.base}/foto/${pid}${q ? `?${q}` : ""}`, {
    badges: where.owner,
  });
  return where.owner ? markCover(items, opts.coverPid) : items;
}
