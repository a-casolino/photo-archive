import { originalDone } from "@/lib/imports";
import { originalBody } from "@/lib/import-shared";
import { importRoute } from "../../../../_lib/handler";

/** L'originale è stato caricato: il server controlla la dimensione e accende il download. */
export const POST = importRoute(originalBody, async ({ imp, body }) => Response.json(await originalDone(imp.id, body.sha256)));
