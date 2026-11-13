import type { NextRequest } from "next/server";
import { getAlbum, getAlbumById, isAlbumInBranch, signKeys, slideshowPhotos, type AlbumRow } from "@/lib/gallery";
import { getCurrentUser } from "@/lib/session";
import { getLinkShare, getUserShare, type ShareRow } from "@/lib/shares";
import { SLIDE_BATCH, SLIDE_URL_TTL_SECONDS, type SlideshowResponse } from "@/lib/slideshow-rules";

/*
 * Foto della presentazione di un album, a blocchi, con gli URL firmati delle
 * anteprime grandi (la versione mostrata: l'export di Lightroom se c'è).
 *   ?album=<album>                          proprietario
 *   ?s=<condivisione>[&album=<sotto-album>] condivisione protetta (login)
 *   ?t=<token>[&album=<sotto-album>]        link libero
 *   &rami=1        anche le foto dei sotto-album
 *   &solo=regolazioni   solo le foto con un export collegato
 *   &da=<n>        dalla foto n (blocchi di SLIDE_BATCH)
 * Gli stessi controlli delle pagine: per le condivisioni solo l'album
 * condiviso o un suo sotto-album. Nessun dato privato (GPS, persone).
 */

function deny(status: number, text: string) {
  return Response.json({ error: text }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const albumParam = sp.get("album");
  const token = sp.get("t");
  const shareId = sp.get("s");

  let album: AlbumRow | null = null;
  if (token || shareId) {
    let share: ShareRow | null;
    if (token) {
      share = await getLinkShare(token);
    } else {
      const user = await getCurrentUser();
      if (!user) return deny(401, "Accesso richiesto.");
      share = await getUserShare(shareId!, user);
    }
    if (!share || share.target_type !== "album" || !share.album_id) return deny(404, "Condivisione non trovata.");
    const root = await getAlbumById(share.album_id);
    if (!root) return deny(404, "Album non trovato.");
    if (!albumParam || albumParam === root.public_id) {
      album = root;
    } else {
      const sub = await getAlbum(albumParam);
      if (!sub || !(await isAlbumInBranch(root.id, sub.id))) return deny(404, "Album non trovato.");
      album = sub;
    }
  } else {
    const user = await getCurrentUser();
    if (!user) return deny(401, "Accesso richiesto.");
    if (user.role !== "owner") return deny(403, "Non autorizzato.");
    album = albumParam ? await getAlbum(albumParam) : null;
    if (!album) return deny(404, "Album non trovato.");
  }

  const offset = Math.max(0, Math.floor(Number(sp.get("da")) || 0));
  const { total, photos } = await slideshowPhotos(album.id, {
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
