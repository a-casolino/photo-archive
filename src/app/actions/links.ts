"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { execute, queryOne } from "@/lib/db";
import { randomBase62 } from "@/lib/crypto";
import { getAlbum, getPhoto } from "@/lib/gallery";
import { namedLinkUrl } from "@/lib/named-links";
import { normalizeSlug, slugProblem } from "@/lib/named-link-rules";
import { requireOwner } from "@/lib/session";
import { firstError } from "@/lib/validation";

/*
 * Link con nome (/l/<nome>): solo il proprietario li crea, li fa puntare
 * altrove, li disattiva ed elimina. Ogni azione fa requireOwner da sé.
 */

export type NamedLinkState = { error?: string; ok?: string; link?: string } | undefined;

const publicId = z.string().regex(/^[0-9A-Za-z]{22}$/, { error: "Elemento non valido." });
/**
 * Destinazione nei form: "album:<public_id>", "photo:<public_id>" o "none"
 * (nessuna: chi apre il link vede la pagina vuota).
 */
const targetField = z
  .string()
  .regex(/^((album|photo):[0-9A-Za-z]{22}|none)$/, { error: "Scegli a cosa deve puntare il link." });
const downloadField = z.enum(["none", "preview"], { error: "Scegli cosa si può scaricare." });

async function resolveTarget(
  value: string,
): Promise<{ albumId: number | null; photoId: number | null; path: string | null } | null> {
  if (value === "none") return { albumId: null, photoId: null, path: null };
  const [type, pid] = value.split(":");
  if (type === "album") {
    const album = await getAlbum(pid);
    return album ? { albumId: album.id, photoId: null, path: `/album/${album.public_id}` } : null;
  }
  const photo = await getPhoto(pid);
  return photo ? { albumId: null, photoId: photo.id, path: `/foto/${photo.public_id}` } : null;
}

function refresh(...paths: (string | null | undefined)[]) {
  revalidatePath("/admin/link");
  for (const p of paths) if (p) revalidatePath(p);
}

function backPath(formData: FormData): string | null {
  const back = formData.get("back");
  return typeof back === "string" && /^\/(album|foto)\/[0-9A-Za-z]{22}$/.test(back) ? back : null;
}

export async function createNamedLink(_: NamedLinkState, formData: FormData): Promise<NamedLinkState> {
  const owner = await requireOwner();
  const slug = normalizeSlug(String(formData.get("name") ?? ""));
  const problem = slugProblem(slug);
  if (problem) return { error: problem };
  const parsed = z
    .object({ target: targetField, allowDownload: downloadField })
    .safeParse({ target: formData.get("target"), allowDownload: formData.get("allowDownload") ?? "preview" });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const t = await resolveTarget(parsed.data.target);
  if (!t) return { error: "Album o foto non trovati." };

  try {
    await execute(
      `INSERT INTO named_links (public_id, slug, photo_id, album_id, allow_download, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomBase62(22), slug, t.photoId, t.albumId, parsed.data.allowDownload, owner.id],
    );
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
      return { error: `Il nome «${slug}» è già usato: cambialo, oppure fai puntare qui quel link.` };
    }
    throw e;
  }
  refresh(t.path, backPath(formData));
  return { ok: `Link «${slug}» creato.`, link: namedLinkUrl(slug) };
}

/** Nuova destinazione e/o download di un link con nome. */
export async function updateNamedLink(_: NamedLinkState, formData: FormData): Promise<NamedLinkState> {
  await requireOwner();
  const parsed = z
    .object({
      linkId: publicId,
      target: z.union([z.literal(""), targetField]),
      allowDownload: z.union([z.literal(""), downloadField]),
    })
    .safeParse({
      linkId: formData.get("linkId"),
      target: formData.get("target") ?? "",
      allowDownload: formData.get("allowDownload") ?? "",
    });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const v = parsed.data;
  const link = await queryOne<{ id: number; slug: string }>("SELECT id, slug FROM named_links WHERE public_id = ?", [
    v.linkId,
  ]);
  if (!link) return { error: "Link non trovato." };

  let path: string | null = null;
  if (v.target) {
    const t = await resolveTarget(v.target);
    if (!t) return { error: "Album o foto non trovati." };
    path = t.path;
    await execute(
      "UPDATE named_links SET album_id = ?, photo_id = ?, pointed_at = UTC_TIMESTAMP() WHERE id = ?",
      [t.albumId, t.photoId, link.id],
    );
  }
  if (v.allowDownload) {
    await execute("UPDATE named_links SET allow_download = ? WHERE id = ?", [v.allowDownload, link.id]);
  }
  refresh(path, backPath(formData));
  return {
    ok: v.target === "none" ? `«${link.slug}» ora non punta a nulla.` : v.target ? `«${link.slug}» ora punta qui.` : "Link aggiornato.",
  };
}

const linkIdForm = z.object({ linkId: publicId });

export async function setNamedLinkEnabled(formData: FormData): Promise<void> {
  await requireOwner();
  const { linkId } = linkIdForm.parse({ linkId: formData.get("linkId") });
  const enable = formData.get("enable") === "1";
  await execute(
    enable
      ? "UPDATE named_links SET disabled_at = NULL WHERE public_id = ?"
      : "UPDATE named_links SET disabled_at = UTC_TIMESTAMP() WHERE public_id = ? AND disabled_at IS NULL",
    [linkId],
  );
  refresh(backPath(formData));
}

/** Elimina un link già disattivato: il nome torna libero. */
export async function deleteNamedLink(formData: FormData): Promise<void> {
  await requireOwner();
  const { linkId } = linkIdForm.parse({ linkId: formData.get("linkId") });
  await execute("DELETE FROM named_links WHERE public_id = ? AND disabled_at IS NOT NULL", [linkId]);
  refresh(backPath(formData));
}
