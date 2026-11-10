import { originalTarget } from "@/lib/imports";
import { originalBody } from "@/lib/import-shared";
import { importRoute } from "../../../_lib/handler";

/** Dove caricare l'originale di una foto registrata prima del file (sessione riprendibile). */
export const POST = importRoute(originalBody, async ({ body, request }) =>
  Response.json(await originalTarget(body.sha256, { fresh: body.fresh, origin: request.headers.get("origin") })),
);
