import { prepareUpload } from "@/lib/imports";
import { prepareBody } from "@/lib/import-shared";
import { importRoute } from "../../../_lib/handler";

/** URL firmati per caricare originale, anteprima e miniatura. */
export const POST = importRoute(prepareBody, async ({ body }) => Response.json(await prepareUpload(body)));
