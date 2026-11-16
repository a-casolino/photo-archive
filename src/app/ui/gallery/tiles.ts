import { displaySize } from "@/lib/gallery-rules";
import type { PhotoCard } from "@/lib/gallery";
import type { MasonryItem } from "./masonry";

/*
 * Dalle foto lette dal database ai riquadri della griglia. Usato dalle
 * pagine (primo blocco) e da /api/griglia (blocchi successivi), così i
 * riquadri sono identici.
 */

export function photoTitle(p: Pick<PhotoCard, "title" | "original_filename">): string {
  return p.title || p.original_filename;
}

export function ratioOf(p: Pick<PhotoCard, "width" | "height" | "orientation">): number | null {
  const size = displaySize(p.width, p.height, p.orientation);
  return size ? size.height / size.width : null;
}

export function photoItems(
  cards: PhotoCard[],
  urls: Map<string, string>,
  hrefFor: (pid: string) => string,
  opts: { badges?: boolean } = {},
): MasonryItem[] {
  return cards.map((p) => ({
    key: p.public_id,
    href: hrefFor(p.public_id),
    src: p.thumb_key ? (urls.get(p.thumb_key) ?? null) : null,
    alt: photoTitle(p),
    ratio: ratioOf(p),
    badge: opts.badges && p.edited ? "Lightroom" : undefined,
    extra: p.section === "extra" ? true : undefined,
  }));
}

/** Etichetta "Copertina" sulla foto di copertina dell'album (solo proprietario). */
export function markCover(items: MasonryItem[], coverPid: string | null | undefined): MasonryItem[] {
  if (!coverPid) return items;
  return items.map((it) =>
    it.key === coverPid ? { ...it, badge: it.badge ? `Copertina · ${it.badge}` : "Copertina" } : it,
  );
}
