import type { NextRequest } from "next/server";
import { parseBatch } from "@/lib/grid-rules";
import { peopleOptions } from "@/lib/people";
import { photoFilterFromParams } from "@/lib/photo-filter-params";
import { photoDevices } from "@/lib/photos";
import { photoTiles } from "@/lib/photo-grid";
import { getCurrentUser } from "@/lib/session";
import { listTags } from "@/lib/tags";

/*
 * Blocchi successivi della pagina Foto (solo proprietario), mentre si
 * scorre. Stessi parametri dei filtri della pagina più &da=<n>&n=<quante>.
 */

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return deny(401, "Accesso richiesto.");
  if (user.role !== "owner") return deny(403, "Non autorizzato.");
  const url = request.nextUrl.searchParams;
  const [people, tags, devices] = await Promise.all([peopleOptions(), listTags(), photoDevices()]);
  const { filter, query } = photoFilterFromParams(Object.fromEntries(url.entries()), { people, tags, devices });
  const { offset, limit } = parseBatch(url.get("da"), url.get("n"));
  const items = await photoTiles(filter, query, offset, limit);
  return Response.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
}
