import { commitPhoto } from "@/lib/imports";
import { commitBody } from "@/lib/import-shared";
import { importRoute } from "../../../_lib/handler";

/** Registra una foto dopo che i file sono stati caricati. */
export const POST = importRoute(commitBody, async ({ imp, body }) =>
  Response.json(await commitPhoto(imp.id, imp.source, body)),
);
