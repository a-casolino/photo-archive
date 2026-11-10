import "server-only";
import { z } from "zod";
import { BROWSER_DEVICE, deviceFromRequest, ImportProblem, runningImport, type ImportDevice } from "@/lib/imports";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/session";
import { MIN_PROGRAM_VERSION, PROGRAM_VERSION_HEADER, type ImportSource } from "@/lib/import-shared";

/*
 * Utilità comuni delle route usate dal programma di import e dalla pagina
 * "Carica dal browser". Autenticazione con la chiave del computer (Bearer)
 * oppure con la sessione del proprietario (solo da questa stessa app:
 * l'header Origin deve essere il nostro, contro le richieste da altri siti).
 * Corpo JSON validato con zod, errori sempre come { error: "..." } in italiano.
 */

/** Richiesta partita da una pagina di questa app (Origin = APP_URL o l'host della richiesta). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const host = new URL(origin).host;
    const allowed = [new URL(env().APP_URL).host, request.headers.get("x-forwarded-host"), request.headers.get("host")];
    return allowed.includes(host);
  } catch {
    return false;
  }
}

async function authenticate(request: Request): Promise<ImportDevice | null> {
  if (request.headers.get("authorization")) return deviceFromRequest(request);
  if (!sameOrigin(request)) return null;
  const user = await getCurrentUser();
  return user?.role === "owner" ? BROWSER_DEVICE : null;
}

export function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

type Handler<T> = (ctx: { device: ImportDevice; body: T; request: Request }) => Promise<Response>;

export function deviceRoute<T>(schema: z.ZodType<T> | null, handler: Handler<T>) {
  return async (request: Request): Promise<Response> => {
    try {
      const device = await authenticate(request);
      if (!device) return jsonError(401, "Chiave del computer mancante, sbagliata o revocata (o sessione scaduta).");
      const version = Number(request.headers.get(PROGRAM_VERSION_HEADER) ?? 0);
      if (!(version >= MIN_PROGRAM_VERSION)) {
        return jsonError(
          426,
          "Il programma di import sul computer è vecchio: aggiornalo con «git pull» (e «npm ci») e rilancia lo stesso comando.",
        );
      }
      let body = undefined as T;
      if (schema) {
        const raw = await request.json().catch(() => undefined);
        const parsed = schema.safeParse(raw);
        if (!parsed.success) return jsonError(400, "Richiesta non valida: " + z.prettifyError(parsed.error));
        body = parsed.data;
      }
      return await handler({ device, body, request });
    } catch (e) {
      if (e instanceof ImportProblem) return jsonError(409, e.message);
      console.error("[import api]", e);
      return jsonError(500, "Errore interno del server.");
    }
  };
}

/** Route su un import aperto: /api/import/v1/imports/[id]/... */
export function importRoute<T>(
  schema: z.ZodType<T> | null,
  handler: (ctx: { imp: { id: number; source: ImportSource }; body: T; device: ImportDevice; request: Request }) => Promise<Response>,
) {
  return async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    return deviceRoute(schema, async ({ device, body, request: req }) => {
      const imp = await runningImport(id);
      if (!imp) return jsonError(404, "Import non trovato o già chiuso.");
      return handler({ imp, body, device, request: req });
    })(request);
  };
}
