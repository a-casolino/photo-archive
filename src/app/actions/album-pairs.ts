"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PAIR_SURE_SHARE } from "@/lib/album-pair-rules";
import { computeAlbumPairs } from "@/lib/album-pairs";
import { execute } from "@/lib/db";
import { requireOwner } from "@/lib/session";

const PATH = "/admin/import/coppie";

export async function recomputeAlbumPairs(): Promise<void> {
  await requireOwner();
  await computeAlbumPairs();
  revalidatePath(PATH);
}

const pair = z.object({
  google: z.string().length(22),
  folder: z.string().length(22),
  decision: z.enum(["confirm", "reject", "reset"]),
});

export async function decideAlbumPair(formData: FormData): Promise<void> {
  await requireOwner();
  const d = pair.parse(Object.fromEntries(formData));
  const status = d.decision === "confirm" ? "confirmed" : d.decision === "reject" ? "rejected" : "proposed";
  await execute(
    `UPDATE album_pairs ap
       JOIN albums g ON g.id = ap.google_album_id AND g.public_id = ?
       JOIN albums f ON f.id = ap.folder_album_id AND f.public_id = ?
        SET ap.status = ?, ap.decided_at = IF(? = 'proposed', NULL, UTC_TIMESTAMP())`,
    [d.google, d.folder, status, status],
  );
  revalidatePath(PATH);
}

/** Conferma in blocco le proposte in cui la cartella ha quasi tutte le foto dell'album. */
export async function confirmSurePairs(): Promise<void> {
  await requireOwner();
  await execute(
    `UPDATE album_pairs SET status = 'confirmed', decided_at = UTC_TIMESTAMP()
      WHERE status = 'proposed' AND shared_photos >= album_photos * ?`,
    [PAIR_SURE_SHARE],
  );
  revalidatePath(PATH);
}
