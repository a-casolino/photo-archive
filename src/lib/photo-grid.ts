import "server-only";
import type { MasonryItem } from "@/app/ui/gallery/masonry";
import { photoItems } from "@/app/ui/gallery/tiles";
import { signKeys } from "./gallery";
import { listPhotos, type PhotoFilter } from "./photos";

/*
 * Riquadri della pagina Foto (tutto l'archivio, con i filtri) a blocchi: il
 * primo lo disegna la pagina, gli altri arrivano da /api/foto-elenco.
 * `query` sono i parametri validi dei filtri, riportati nei link delle foto.
 */
export async function photoTiles(
  filter: PhotoFilter,
  query: Record<string, string>,
  offset: number,
  limit: number,
): Promise<MasonryItem[]> {
  const photos = await listPhotos(filter, offset, limit);
  const urls = await signKeys(photos.map((p) => p.thumb_key));
  // La foto si apre con gli stessi filtri: frecce e swipe scorrono questo elenco.
  const photoQuery = new URLSearchParams({ da: "foto", ...query }).toString();
  return photoItems(photos, urls, (pid) => `/foto/${pid}?${photoQuery}`, { badges: true });
}
