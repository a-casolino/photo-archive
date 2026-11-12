"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAlbum, mergeAlbums, moveAlbum, removePhotosFromAlbum } from "@/lib/albums";
import { mergeSelection } from "@/lib/gallery-rules";
import { requireOwner } from "@/lib/session";
import { firstError, type FormState } from "@/lib/validation";

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

// ---------------------------------------------------------------------
// Sotto-album
// ---------------------------------------------------------------------

const newAlbumForm = z.object({
  title: z.string().trim().min(1, { error: "Scrivi il titolo." }).max(255, { error: "Il titolo è troppo lungo." }),
  parent: publicId.optional(),
});

/** "Nuovo album" / "Nuovo sotto-album" (solo proprietario): poi si apre l'album creato. */
export async function createAlbumAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = newAlbumForm.safeParse({
    title: formData.get("title") ?? "",
    parent: formData.get("parent") || undefined,
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const res = await createAlbum(parsed.data.title, parsed.data.parent ?? null);
  if (!res.ok) return { error: res.error };
  revalidatePath("/album", "layout");
  redirect(`/album/${res.publicId}`);
}

const moveForm = z.object({
  albumId: publicId,
  parent: publicId.optional(),
});

/** "Sposta in…": dentro un altro album o al primo livello (solo proprietario). */
export async function moveAlbumAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = moveForm.safeParse({
    albumId: formData.get("albumId"),
    parent: formData.get("parent") || undefined,
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const res = await moveAlbum(parsed.data.albumId, parsed.data.parent ?? null);
  if (!res.ok) return { error: res.error };
  revalidatePath("/album", "layout");
  revalidatePath("/dashboard");
  redirect(`/album/${parsed.data.albumId}?spostato=1`);
}

/** "Togli dall'album": le foto selezionate escono dall'album ma restano nell'archivio. */
export async function removeFromAlbumAction(formData: FormData): Promise<void> {
  await requireOwner();
  const albumId = publicId.parse(formData.get("albumId"));
  const photos = z.array(publicId).max(1000).parse(formData.getAll("photo").map(String));
  const raw = formData.get("back");
  // Solo la pagina dell'album stesso (con pagina e filtro), mai un indirizzo esterno.
  const back = typeof raw === "string" && raw.startsWith(`/album/${albumId}`) ? raw : `/album/${albumId}`;
  const n = await removePhotosFromAlbum(albumId, photos);
  revalidatePath("/album", "layout");
  revalidatePath("/foto", "layout");
  revalidatePath("/dashboard");
  redirect(n ? `${back}${back.includes("?") ? "&" : "?"}tolte=${n}` : back);
}
