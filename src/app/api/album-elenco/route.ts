import type { NextRequest } from "next/server";
import { albumListParams, albumListSlice } from "@/lib/album-list";
import { FILTER_PARAMS } from "@/lib/filter-rules";
import { parseBatch } from "@/lib/grid-rules";
import { peopleOptions } from "@/lib/people";
import { getCurrentUser } from "@/lib/session";

/*
 * Blocchi successivi dell'elenco della pagina Album (solo proprietario),
 * mentre si scorre. Stessi parametri della pagina (ricerca e filtri) più
 * &da=<n>&n=<quanti>.
 */

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return deny(401, "Accesso richiesto.");
  if (user.role !== "owner") return deny(403, "Non autorizzato.");
  const url = request.nextUrl.searchParams;
  const sp = Object.fromEntries(url.entries());
  const people = sp[FILTER_PARAMS.person] !== undefined ? await peopleOptions() : [];
  const { offset, limit } = parseBatch(url.get("da"), url.get("n"));
  const body = await albumListSlice(albumListParams(sp, people), offset, limit);
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
