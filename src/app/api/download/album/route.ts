import type { NextRequest } from "next/server";
import { albumAccess } from "@/lib/album-access";
import { albumZip } from "@/lib/album-zip";
import { safeZipName, zipStream } from "@/lib/zip-writer";
import { hit } from "@/lib/rate-limit";
import { canDownload } from "@/lib/roles";
import { recordShareEvent } from "@/lib/shares";
import { attachmentDisposition } from "@/lib/storage";

/*
 * "Scarica tutte": l'album (con i sotto-album) in un unico ZIP, in JPEG.
 * Chi può scaricare quale album: vedi albumAccess (?album, ?s, ?t) e il
 * livello di download (ruolo + condivisione, effectiveDownload): serve
 * almeno il JPEG grande. Se la condivisione è "Solo visione", niente ZIP.
 *
 * Lo ZIP si costruisce mentre si scarica (nessun file temporaneo, memoria
 * costante): ogni foto passa da GCS alla VPS e subito al browser.
 */

export const dynamic = "force-dynamic";

/** Al massimo tanti ZIP all'ora per ogni condivisione e indirizzo: frena chi abusa di un link libero. */
const ZIP_PER_HOUR = 10;

function deny(status: number, text: string) {
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const access = await albumAccess(sp);
  if ("error" in access) return deny(access.status, access.error);
  if (!canDownload(access.level, "preview")) return deny(403, "Il download non è consentito.");

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (access.role !== "owner" && !hit(`zip:${access.share?.id ?? 0}:${ip ?? "?"}`, ZIP_PER_HOUR, 3600_000)) {
    return deny(429, "Troppi download dell'album in poco tempo: riprova tra un'ora.");
  }

  const zip = await albumZip(access.album.id);
  if (zip.count === 0) return deny(404, "Nell'album non ci sono foto da scaricare.");

  if (access.share && access.role !== "owner") {
    // Un solo evento per lo ZIP (photo_id vuoto), non uno per foto.
    await recordShareEvent(access.share, "download_preview", {
      userId: access.userId,
      ip,
    });
  }

  const parts = zipStream(zip.entries, {
    onSkip: (name) => console.warn(`[zip] ${name}: file non disponibile, saltato.`),
  });
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await parts.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        console.error("[zip] errore durante lo ZIP dell'album:", e);
        controller.error(e);
      }
    },
    async cancel() {
      // Il browser ha interrotto: si smette di leggere da GCS.
      await parts.return(undefined);
    },
  });

  const fileName = `${safeZipName(access.album.title, "Album")}.zip`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": attachmentDisposition(fileName),
      "Cache-Control": "no-store",
      // Niente buffer del proxy davanti a Node: lo ZIP deve uscire mentre si crea.
      "X-Accel-Buffering": "no",
    },
  });
}
