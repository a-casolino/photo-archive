import type { NextRequest } from "next/server";
import { albumAccess } from "@/lib/album-access";
import { signKeys, slideshowPhotos } from "@/lib/gallery";
import { SLIDE_BATCH, SLIDE_URL_TTL_SECONDS, type SlideshowResponse } from "@/lib/slideshow-rules";

/*
 * Foto della presentazione di un album, a blocchi, con gli URL firmati delle
 * anteprime grandi (la versione mostrata: l'export di Lightroom se c'è).
 * Chi può leggere quale album: vedi albumAccess (?album, ?s, ?t).
 *   &rami=1        anche le foto dei sotto-album
 *   &solo=regolazioni   solo le foto con un export collegato
 *   &da=<n>        dalla foto n (blocchi di SLIDE_BATCH)
 * Nessun dato privato (GPS, persone).
 */

function deny(status: number, text: string) {
  return Response.json({ error: text }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const access = await albumAccess(sp);
  if ("error" in access) return deny(access.status, access.error);

  const offset = Math.max(0, Math.floor(Number(sp.get("da")) || 0));
  const { total, photos } = await slideshowPhotos(access.album.id, {
    branch: sp.get("rami") === "1",
    onlyEdited: sp.get("solo") === "regolazioni",
    offset,
    limit: SLIDE_BATCH,
  });
  const urls = await signKeys(
    photos.map((p) => p.preview_key),
    SLIDE_URL_TTL_SECONDS,
  );
  const body: SlideshowResponse = {
    total,
    offset,
    slides: photos.map((p) => ({
      id: p.public_id,
      src: p.preview_key ? (urls.get(p.preview_key) ?? null) : null,
      name: p.title || p.original_filename,
      takenAt: p.taken_at ? new Date(p.taken_at).toISOString() : null,
    })),
  };
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
