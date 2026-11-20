"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearCache } from "@/lib/cache";
import { requireOwner } from "@/lib/session";

/** "Svuota cache" in Statistiche: la prossima pagina rilegge tutto dal database. */
export async function clearCacheAction(): Promise<void> {
  await requireOwner();
  const n = clearCache();
  revalidatePath("/", "layout");
  redirect(`/admin/statistiche?cache=${n}#cache`);
}
