import { finishImport } from "@/lib/imports";
import { finishBody } from "@/lib/import-shared";
import { importRoute } from "../../../_lib/handler";

/** Chiude l'import e collega in automatico gli export ai CR2. */
export const POST = importRoute(finishBody, async ({ imp, body }) =>
  Response.json(await finishImport(imp.id, body.status, body.log)),
);
