"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAlbum, getPhoto } from "@/lib/gallery";
import { parseTagInput, TAG_MAX_LENGTH } from "@/lib/gallery-rules";
import { requireOwner } from "@/lib/session";
import { addTags, deleteTag, removeTag, renameTag, type TagTarget } from "@/lib/tags";
import type { FormState } from "@/lib/validation";

/* Tag su foto e album: solo il proprietario (requireOwner in ogni azione). */

const targetForm = z.object({
  kind: z.enum(["photo", "album"]),
  targetId: z.string().regex(/^[0-9A-Za-z]{22}$/),
});

async function resolveTarget(formData: FormData): Promise<{ target: TagTarget; path: string }> {
  const { kind, targetId } = targetForm.parse({ kind: formData.get("kind"), targetId: formData.get("targetId") });
  const row = kind === "album" ? await getAlbum(targetId) : await getPhoto(targetId);
  if (!row) throw new Error("Elemento non trovato.");
  return { target: { kind, id: row.id }, path: `/${kind === "album" ? "album" : "foto"}/${targetId}` };
}

function refresh(path: string) {
  revalidatePath(path);
  revalidatePath("/tag", "layout");
}

export async function addTagsAction(formData: FormData): Promise<void> {
  await requireOwner();
  const { target, path } = await resolveTarget(formData);
  const names = parseTagInput(String(formData.get("names") ?? ""));
  if (!names.length) return;
  await addTags(target, names.slice(0, 20));
  refresh(path);
}

export async function removeTagAction(formData: FormData): Promise<void> {
  await requireOwner();
  const { target, path } = await resolveTarget(formData);
  const tagId = z.coerce.number().int().positive().parse(formData.get("tagId"));
  await removeTag(target, tagId);
  refresh(path);
}

const renameForm = z.object({
  tagId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, { error: "Il nome non può essere vuoto." }).max(TAG_MAX_LENGTH),
});

export async function renameTagAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = renameForm.safeParse({ tagId: formData.get("tagId"), name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dati non validi." };
  const res = await renameTag(parsed.data.tagId, parsed.data.name.replace(/\s+/g, " "));
  if ("error" in res) return { error: res.error };
  revalidatePath("/tag", "layout");
  redirect(`/tag/${encodeURIComponent(res.slug)}`);
}

export async function deleteTagAction(formData: FormData): Promise<void> {
  await requireOwner();
  const tagId = z.coerce.number().int().positive().parse(formData.get("tagId"));
  await deleteTag(tagId);
  revalidatePath("/tag", "layout");
  redirect("/tag");
}
