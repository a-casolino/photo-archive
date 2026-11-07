import { startImport } from "@/lib/imports";
import { createImportBody } from "@/lib/import-shared";
import { deviceRoute } from "../_lib/handler";

/** Inizia un import (o ne riprende uno interrotto). */
export const POST = deviceRoute(createImportBody, async ({ device, body }) =>
  Response.json(await startImport(device, body), { status: 201 }),
);
