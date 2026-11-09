"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { execute, queryOne } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { getAlbum, getPhoto, inSubalbums } from "@/lib/gallery";
import { requireOwner } from "@/lib/session";
import {
  addRecipients,
  createShare,
  defaultLinkDays,
  encryptLinkToken,
  linkUrl,
  newLinkToken,
} from "@/lib/shares";
import { firstError } from "@/lib/validation";

/*
 * Condivisioni: solo il proprietario crea, revoca e rinnova. Ogni azione
 * controlla il ruolo da sé (requireOwner), non si fida della pagina.
 */

export type ShareFormState =
  | { error?: string; ok?: string; link?: string }
  | undefined;

const publicId = z
  .string()
  .regex(/^[0-9A-Za-z]{22}$/, { error: "Elemento non valido." });

const shareForm = z
  .object({
    targetType: z.enum(["photo", "album"]),
    targetId: publicId,
    mode: z.enum(["users", "link"], {
      error: "Scegli il tipo di condivisione.",
    }),
    allowDownload: z.enum(["none", "preview", "original"], {
      error: "Scegli cosa si può scaricare.",
    }),
    message: z.string().trim().max(2000).optional(),
    recipients: z.array(z.coerce.number().int().positive()),
    days: z.coerce
      .number()
      .int()
      .min(1, { error: "Durata minima 1 giorno." })
      .max(365, { error: "Durata massima 365 giorni." }),
  })
  .refine((v) => v.mode === "link" || v.recipients.length > 0, {
    error: "Scegli almeno una persona.",
    path: ["recipients"],
  })
  .refine((v) => v.mode === "users" || v.allowDownload !== "original", {
    error: "I link liberi non possono dare l'originale: al massimo il JPEG.",
    path: ["allowDownload"],
  });

async function resolveTarget(type: "photo" | "album", id: string) {
  if (type === "album") {
    const album = await getAlbum(id);
    return album
      ? {
          target: { type: "album" as const, albumId: album.id },
          title: album.title,
          path: `/album/${album.public_id}`,
        }
      : null;
  }
  const photo = await getPhoto(id);
  return photo
    ? {
        target: { type: "photo" as const, photoId: photo.id },
        title: photo.title ?? photo.original_filename,
        path: `/foto/${photo.public_id}`,
      }
    : null;
}

export async function createShareAction(
  _: ShareFormState,
  formData: FormData,
): Promise<ShareFormState> {
  const owner = await requireOwner();
  const parsed = shareForm.safeParse({
    targetType: formData.get("targetType"),
    targetId: formData.get("targetId"),
    mode: formData.get("mode"),
    allowDownload: formData.get("allowDownload"),
    message: formData.get("message") ?? undefined,
    recipients: formData.getAll("recipients"),
    days: formData.get("days") || defaultLinkDays(),
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const v = parsed.data;
  const t = await resolveTarget(v.targetType, v.targetId);
  if (!t) return { error: "Elemento non trovato." };

  const { token } = await createShare({
    target: t.target,
    title: t.title,
    mode: v.mode,
    allowDownload: v.allowDownload,
    message: v.message || null,
    recipientIds: v.recipients,
    linkDays: v.days,
    createdBy: owner,
  });
  revalidatePath(t.path);
  revalidatePath("/admin/condivisioni");
  if (token) {
    return {
      ok: `Link creato, valido ${v.days} giorni. Lo trovi anche nell'elenco delle condivisioni.`,
      link: linkUrl(token),
    };
  }
  return {
    ok: `Condiviso con ${v.recipients.length === 1 ? "1 persona" : `${v.recipients.length} persone`}.`,
  };
}

const shareIdForm = z.object({ shareId: publicId });

async function ownedShare(formData: FormData) {
  const { shareId } = shareIdForm.parse({ shareId: formData.get("shareId") });
  const share = await queryOne<{
    id: number;
    public_id: string;
    mode: "users" | "link";
    target_title: string;
  }>(
    `SELECT s.id, s.public_id, s.mode, COALESCE(a.title, p.title, p.original_filename) AS target_title
       FROM shares s LEFT JOIN albums a ON a.id = s.album_id LEFT JOIN photos p ON p.id = s.photo_id
      WHERE s.public_id = ?`,
    [shareId],
  );
  if (!share) throw new Error("Condivisione non trovata.");
  return share;
}

function refresh(formData: FormData) {
  revalidatePath("/admin/condivisioni");
  const back = formData.get("back");
  if (
    typeof back === "string" &&
    /^\/(album|foto)\/[0-9A-Za-z]{22}$/.test(back)
  )
    revalidatePath(back);
}

export async function revokeShare(formData: FormData): Promise<void> {
  await requireOwner();
  const share = await ownedShare(formData);
  await execute(
    "UPDATE shares SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND revoked_at IS NULL",
    [share.id],
  );
  refresh(formData);
}

/** Link libero: nuova scadenza a N giorni da oggi (anche se era scaduto). */
export async function renewLink(formData: FormData): Promise<void> {
  await requireOwner();
  const share = await ownedShare(formData);
  const days = z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .catch(defaultLinkDays())
    .parse(formData.get("days"));
  await execute(
    "UPDATE shares SET expires_at = UTC_TIMESTAMP() + INTERVAL ? DAY WHERE id = ? AND mode = 'link' AND revoked_at IS NULL",
    [days, share.id],
  );
  refresh(formData);
}

/** Link libero: nuovo token (il vecchio link smette di funzionare). */
export async function regenerateLink(
  _: ShareFormState,
  formData: FormData,
): Promise<ShareFormState> {
  await requireOwner();
  const share = await ownedShare(formData);
  if (share.mode !== "link") return { error: "Non è un link libero." };
  const token = newLinkToken();
  const res = await execute(
    "UPDATE shares SET token = ?, token_enc = ? WHERE id = ? AND revoked_at IS NULL",
    [sha256(token), encryptLinkToken(token), share.id],
  );
  if (!res.affectedRows) return { error: "La condivisione è revocata." };
  refresh(formData);
  return {
    ok: "Nuovo link creato: quello vecchio non funziona più.",
    link: linkUrl(token),
  };
}

export async function addShareRecipients(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const share = await ownedShare(formData);
  if (share.mode !== "users") return;
  const ids = z
    .array(z.coerce.number().int().positive())
    .parse(formData.getAll("recipients"));
  await addRecipients(
    share.id,
    share.public_id,
    ids,
    share.target_title,
    owner.name,
  );
  refresh(formData);
}

export async function removeShareRecipient(formData: FormData): Promise<void> {
  await requireOwner();
  const share = await ownedShare(formData);
  const userId = z.coerce
    .number()
    .int()
    .positive()
    .parse(formData.get("userId"));
  await execute(
    "DELETE FROM share_recipients WHERE share_id = ? AND user_id = ?",
    [share.id, userId],
  );
  refresh(formData);
}

/**
 * Copertina dell'album: la foto deve farne parte. La foto arriva come `photoId` (pagina della foto)
 * o come unica casella `photo` spuntata nella selezione dell'album; in quel caso si torna all'album.
 */
export async function setAlbumCover(formData: FormData): Promise<void> {
  await requireOwner();
  const albumId = publicId.parse(formData.get("albumId"));
  const picked = formData.getAll("photo").map(String);
  const fromSelection = !formData.has("photoId");
  if (fromSelection && picked.length !== 1) redirect(`/album/${albumId}`);
  const photoId = publicId.parse(
    fromSelection ? picked[0] : formData.get("photoId"),
  );
  // La foto deve stare nell'album o in uno dei suoi sotto-album (controllo a parte:
  // MySQL non permette una sottoquery su albums dentro l'UPDATE di albums).
  const ok = await queryOne<{ album_id: number; photo_id: number }>(
    `SELECT a.id AS album_id, p.id AS photo_id
       FROM albums a JOIN photos p ON p.public_id = ? AND p.deleted_at IS NULL
      WHERE a.public_id = ? AND a.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM album_photos ap
                     WHERE ap.photo_id = p.id AND (ap.album_id = a.id OR ${inSubalbums("ap.album_id", "a")}))`,
    [photoId, albumId],
  );
  if (ok) await execute("UPDATE albums SET cover_photo_id = ? WHERE id = ?", [ok.photo_id, ok.album_id]);
  revalidatePath(`/album/${albumId}`);
  revalidatePath("/album");
  if (fromSelection) redirect(`/album/${albumId}`);
}

const albumForm = z.object({
  albumId: publicId,
  title: z
    .string()
    .trim()
    .min(1, { error: "Il titolo non può essere vuoto." })
    .max(255),
  description: z.string().trim().max(5000),
});

export async function updateAlbum(
  _: ShareFormState,
  formData: FormData,
): Promise<ShareFormState> {
  await requireOwner();
  const parsed = albumForm.safeParse({
    albumId: formData.get("albumId"),
    title: formData.get("title"),
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const { albumId, title, description } = parsed.data;
  await execute(
    "UPDATE albums SET title = ?, description = ? WHERE public_id = ? AND deleted_at IS NULL",
    [title, description || null, albumId],
  );
  revalidatePath(`/album/${albumId}`);
  revalidatePath("/album");
  return { ok: "Album aggiornato." };
}
