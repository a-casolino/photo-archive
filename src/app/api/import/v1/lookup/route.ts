import { lookupExisting } from "@/lib/imports";
import { lookupBody } from "@/lib/import-shared";
import { deviceRoute } from "../_lib/handler";

/** Quali di queste impronte sono già nell'archivio, senza aprire un import (riepilogo del browser). */
export const POST = deviceRoute(lookupBody, async ({ body }) => Response.json(await lookupExisting(body.sha256)));
