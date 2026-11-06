import { storage } from "@/lib/storage";
import { API_VERSION } from "@/lib/import-shared";
import { deviceRoute } from "../_lib/handler";

/** Verifica della chiave: il programma la chiama all'avvio. */
export const GET = deviceRoute(null, async ({ device }) =>
  Response.json({ ok: true, apiVersion: API_VERSION, device: device.name, storage: storage().driver }),
);
