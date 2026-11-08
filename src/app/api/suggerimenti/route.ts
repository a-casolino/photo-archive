import type { NextRequest } from "next/server";
import { albumDates } from "@/app/ui/gallery/dates";
import { formatCount } from "@/lib/format";
import { signKeys } from "@/lib/gallery";
import { parseSearchQuery, type SuggestItem, type SuggestResponse } from "@/lib/search-rules";
import { getCurrentUser } from "@/lib/session";
import { suggest } from "@/lib/suggest";

/*
 * Suggerimenti per la ricerca: GET /api/suggerimenti?q=<testo>.
 * Solo il proprietario: album, tag e persone sono suoi, e tag e persone
 * non vanno mai mostrati a chi riceve condivisioni. Agli altri utenti
 * risponde 404, come se l'indirizzo non esistesse.
 */

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** "1 foto", "12 album": in italiano le due parole non cambiano al plurale. */
function count(n: number, what: "foto" | "album") {
  return `${formatCount(Number(n))} ${what}`;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (user?.role !== "owner") return json({ error: "Non trovato." }, 404);

  const q = parseSearchQuery(request.nextUrl.searchParams.get("q"));
  if (!q) return json({ items: [] } satisfies SuggestResponse);

  const { albums, tags, people } = await suggest(q);
  const urls = await signKeys([...albums.map((a) => a.thumb_key), ...people.map((p) => p.face_key)]);
  const url = (k: string | null) => (k ? (urls.get(k) ?? null) : null);

  const items: SuggestItem[] = [
    ...albums.map((a) => ({
      kind: "album" as const,
      href: `/album/${a.public_id}`,
      title: a.title,
      detail: [albumDates(a), count(a.photo_count, "foto")].filter(Boolean).join(" · "),
      thumb: url(a.thumb_key),
    })),
    ...tags.map((t) => ({
      kind: "tag" as const,
      href: `/tag/${t.slug}`,
      title: t.name,
      detail: [
        Number(t.album_count) ? count(t.album_count, "album") : "",
        count(t.photo_count, "foto"),
      ]
        .filter(Boolean)
        .join(" · "),
      thumb: null,
    })),
    ...people.map((p) => ({
      kind: "person" as const,
      href: `/persone/${p.public_id}`,
      title: p.name,
      detail: count(p.photo_count, "foto"),
      thumb: url(p.face_key),
    })),
  ];
  return json({ items } satisfies SuggestResponse);
}
