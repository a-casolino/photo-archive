import { updateProgress } from "@/lib/imports";
import { progressBody } from "@/lib/import-shared";
import { importRoute } from "../../_lib/handler";

/** Avanzamento: il programma lo manda ogni pochi secondi. */
export const PATCH = importRoute(progressBody, async ({ imp, body }) => {
  await updateProgress(imp.id, body);
  return Response.json({ ok: true });
});
