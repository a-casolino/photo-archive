import type { NextRequest } from "next/server";
import { getPhoto } from "@/lib/gallery";
import { downloadName } from "@/lib/gallery-rules";
import { canDownload, effectiveDownload, type DownloadLevel } from "@/lib/roles";
import { getCurrentUser } from "@/lib/session";
import { getLinkShare, getUserShare, recordShareEvent, shareCoversPhoto, type ShareRow } from "@/lib/shares";
import { storage } from "@/lib/storage";

/*
 * Download di una foto: controlla il permesso lato server e reindirizza a
 * un URL firmato breve (5 minuti) che fa scaricare il file con il suo nome.
 *   ?p=<foto>&v=preview|original            proprietario
 *   ?p=<foto>&v=...&s=<condivisione>        condivisione protetta (login)
 *   ?p=<foto>&v=...&t=<token>               link libero (mai l'originale)
 * "preview" è il JPEG grande della versione mostrata (l'export di Lightroom
 * se c'è); "original" è il file originale (il CR2 per le foto della reflex).
 */

const DOWNLOAD_TTL_SECONDS = 5 * 60;

function deny(status: number, text: string) {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const version = sp.get("v");
  if (version !== "preview" && version !== "original") return deny(400, "Richiesta non valida.");
  const photo = await getPhoto(sp.get("p") ?? "");
  if (!photo) return deny(404, "Foto non trovata.");

  let share: ShareRow | null = null;
  let level: DownloadLevel;
  let userId: number | null = null;
  let isOwner = false;

  const token = sp.get("t");
  const shareId = sp.get("s");
  if (token) {
    share = await getLinkShare(token);
    if (!share) return deny(404, "Link non valido o scaduto.");
    level = effectiveDownload(share.allow_download, null);
  } else {
    const user = await getCurrentUser();
    if (!user) return deny(401, "Accesso richiesto.");
    userId = user.id;
    isOwner = user.role === "owner";
    if (shareId) {
      share = await getUserShare(shareId, user);
      if (!share) return deny(404, "Condivisione non trovata.");
      level = effectiveDownload(share.allow_download, user.role);
    } else if (isOwner) {
      level = "original";
    } else {
      return deny(403, "Non autorizzato.");
    }
  }

  if (share && !(await shareCoversPhoto(share, photo.id))) return deny(404, "Foto non trovata.");
  if (!canDownload(level, version)) return deny(403, "Il download non è consentito.");

  const key = version === "original" ? photo.original_key : photo.preview_key;
  if (!key) return deny(404, "File non disponibile.");

  if (share && !isOwner) {
    await recordShareEvent(share, version === "original" ? "download_original" : "download_preview", {
      userId,
      photoId: photo.id,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
  }

  const url = await storage().readUrl(key, DOWNLOAD_TTL_SECONDS, downloadName(photo.original_filename, version));
  return new Response(null, {
    status: 302,
    // Con l'archivio "local" l'URL è relativo: va bene così (dietro al proxy
    // l'origine vista da Next.js non è quella pubblica).
    headers: { Location: url, "Cache-Control": "no-store" },
  });
}
