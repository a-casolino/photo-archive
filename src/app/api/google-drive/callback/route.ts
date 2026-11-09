import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { connectDrive, DRIVE_STATE_COOKIE, driveConfigured } from "@/lib/google-drive";
import { getCurrentUser } from "@/lib/session";

/*
 * Ritorno dalla pagina di consenso di Google: controlla che sia il
 * proprietario e che lo "state" sia quello messo nel cookie da
 * startDriveConnection, poi salva il token di Drive (cifrato).
 */

function back(query: string) {
  return Response.redirect(new URL(`/admin/import/drive?${query}`, env().APP_URL), 303);
}

function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "owner") return new Response("Accesso negato.", { status: 403 });
  if (!driveConfigured()) return back("errore=config");

  const store = await cookies();
  const expected = store.get(DRIVE_STATE_COOKIE)?.value;
  store.delete(DRIVE_STATE_COOKIE);

  const sp = request.nextUrl.searchParams;
  if (!sameState(expected, sp.get("state"))) return back("errore=stato");
  if (sp.get("error")) return back("errore=negato");
  const code = sp.get("code");
  if (!code) return back("errore=negato");

  try {
    await connectDrive(user.id, code);
  } catch (e) {
    console.error("Collegamento a Google Drive non riuscito:", e);
    return back("errore=google");
  }
  return back("collegato=1");
}
