import "server-only";
import { z } from "zod";
import { deviceFromRequest, ImportProblem, runningImport, type ImportDevice } from "@/lib/imports";
import { MIN_PROGRAM_VERSION, PROGRAM_VERSION_HEADER, type ImportSource } from "@/lib/import-shared";

/*
 * Utilità comuni delle route usate dal programma di import.
 * Autenticazione con la chiave del computer (Bearer), corpo JSON validato
 * con zod, errori sempre come { error: "..." } in italiano.
 */

export function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

type Handler<T> = (ctx: { device: ImportDevice; body: T; request: Request }) => Promise<Response>;

export function deviceRoute<T>(schema: z.ZodType<T> | null, handler: Handler<T>) {
  return async (request: Request): Promise<Response> => {
    try {
      const device = await deviceFromRequest(request);
      if (!device) return jsonError(401, "Chiave del computer mancante, sbagliata o revocata.");
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
  handler: (ctx: { imp: { id: number; source: ImportSource }; body: T; device: ImportDevice }) => Promise<Response>,
) {
  return async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    return deviceRoute(schema, async ({ device, body }) => {
      const imp = await runningImport(id);
      if (!imp) return jsonError(404, "Import non trovato o già chiuso.");
      return handler({ imp, body, device });
    })(request);
  };
}
