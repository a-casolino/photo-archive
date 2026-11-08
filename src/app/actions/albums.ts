"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { mergeAlbums } from "@/lib/albums";
import { mergeSelection } from "@/lib/gallery-rules";
import { requireOwner } from "@/lib/session";
import { firstError } from "@/lib/validation";

export type MergeFormState = { error?: string; needsShareChoice?: boolean } | undefined;

const publicId = z.string().regex(/^[0-9A-Za-z]{22}$/, { error: "Album non valido." });

const mergeForm = z.object({
  albums: z.array(publicId),
  into: publicId.optional(),
  title: z.string().trim().max(255, { error: "Il titolo è troppo lungo." }),
  shares: z.enum(["move", "revoke"]).optional(),
});

/** Unisce gli album scelti in quello da tenere (solo proprietario). */
export async function mergeAlbumsAction(_: MergeFormState, formData: FormData): Promise<MergeFormState> {
  await requireOwner();
  const parsed = mergeForm.safeParse({
    albums: formData.getAll("albums"),
    into: formData.get("into") || undefined,
    title: formData.get("title") ?? "",
    shares: formData.get("shares") || undefined,
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const v = parsed.data;
  if (!v.into) return { error: "Scegli quale album tenere." };
  const sel = mergeSelection(v.albums, v.into);
  if ("error" in sel) return { error: sel.error };

  const res = await mergeAlbums({
    intoPublicId: v.into,
    sourcePublicIds: sel.sources,
    title: v.title || null,
    shares: v.shares ?? null,
  });
  if (!res.ok) return { error: res.error, needsShareChoice: res.needsShareChoice };

  revalidatePath("/album", "layout");
  revalidatePath("/tag", "layout");
  revalidatePath("/admin/condivisioni");
  revalidatePath("/dashboard");
  redirect(`/album/${res.intoPublicId}?unito=${res.merged}`);
}
