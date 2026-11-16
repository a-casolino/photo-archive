import type { NextRequest } from "next/server";
import { albumAccess } from "@/lib/album-access";
import { albumTiles } from "@/lib/album-grid";
import { parseBatch } from "@/lib/grid-rules";

/*
 * Blocchi successivi della griglia di un album, mentre si scorre la pagina.
 * Chi può leggere quale album: vedi albumAccess (?album, ?s, ?t).
 *   &solo=regolazioni   solo le foto con un export collegato
 *   &copertina=<foto>   (proprietario) quale foto ha l'etichetta "Copertina"
 *   &da=<n>&n=<quante>  dalla foto n (di default GRID_BATCH foto)
 * Solo miniature e link, nessun dato privato.
 */

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const access = await albumAccess(sp);
  if ("error" in access) {
    return Response.json({ error: access.error }, { status: access.status, headers: { "Cache-Control": "no-store" } });
  }
  const { offset, limit } = parseBatch(sp.get("da"), sp.get("n"));
  const items = await albumTiles(access, {
    onlyEdited: sp.get("solo") === "regolazioni",
    coverPid: sp.get("copertina"),
    offset,
    limit,
  });
  return Response.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
}
