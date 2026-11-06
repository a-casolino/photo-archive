import { addImportError } from "@/lib/imports";
import { errorBody } from "@/lib/import-shared";
import { importRoute } from "../../../_lib/handler";

/** Un file che non è stato possibile importare. */
export const POST = importRoute(errorBody, async ({ imp, body }) => {
  await addImportError(imp.id, body.sourcePath, body.message);
  return Response.json({ ok: true });
});
