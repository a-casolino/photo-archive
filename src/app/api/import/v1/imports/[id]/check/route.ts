import { checkExisting } from "@/lib/imports";
import { checkBody } from "@/lib/import-shared";
import { importRoute } from "../../../_lib/handler";

/** Quali file sono già nell'archivio (per SHA-256). */
export const POST = importRoute(checkBody, async ({ imp, body }) =>
  Response.json({ existing: await checkExisting(imp.id, body.items) }),
);
