"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/session";
import { purgeAlbums, purgePhotos, restoreAlbum, restorePhotos, trashAlbum, trashPhotos } from "@/lib/trash";

/* Cestino delle foto: solo il proprietario (requireOwner in ogni azione). */

const publicIds = z.array(z.string().regex(/^[0-9A-Za-z]{22}$/)).max(1000);

function photosOf(formData: FormData): string[] {
  return publicIds.parse(formData.getAll("photo").map(String));
}

/** Solo percorsi interni dell'app, mai un indirizzo esterno. */
function safeBack(value: FormDataEntryValue | null, fallback: string): string {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/") && !v.startsWith("//") ? v : fallback;
}

function refreshGalleries() {
  revalidatePath("/album", "layout");
  revalidatePath("/foto", "layout");
  revalidatePath("/tag", "layout");
  revalidatePath("/persone", "layout");
  revalidatePath("/admin/cestino");
}

/** "Sposta nel cestino": una foto (dalla sua pagina) o le selezionate di un album. */
export async function trashPhotosAction(formData: FormData): Promise<void> {
  await requireOwner();
  const ids = photosOf(formData);
  const back = safeBack(formData.get("back"), "/album");
  const n = ids.length ? await trashPhotos(ids) : 0;
  refreshGalleries();
  const sep = back.includes("?") ? "&" : "?";
  redirect(n ? `${back}${sep}cestino=${ids.length}` : back);
}

export async function restorePhotosAction(formData: FormData): Promise<void> {
  await requireOwner();
  const ids = photosOf(formData);
  const n = ids.length ? await restorePhotos(ids) : 0;
  refreshGalleries();
  redirect(n ? `/admin/cestino?ripristinate=${ids.length}` : "/admin/cestino");
}

/**
 * Elimina definitivamente: file dal bucket e righe dal database.
 * Serve la casella di conferma, controllata anche qui (non solo nel browser).
 */
export async function purgePhotosAction(formData: FormData): Promise<void> {
  await requireOwner();
  if (formData.get("conferma") !== "si") redirect("/admin/cestino?errore=conferma");
  const all = formData.get("tutto") === "si";
  // "Svuota cestino": prima gli album con le loro foto, poi le foto rimaste.
  const albums = all ? await purgeAlbums({ all: true }) : { albums: 0, photos: 0, failed: 0 };
  const { deleted, failed } = await purgePhotos(all ? { all: true } : { publicIds: photosOf(formData) });
  refreshGalleries();
  redirect(`/admin/cestino?eliminate=${deleted + albums.photos}&errori=${failed + albums.failed}`);
}

const albumId = z.string().regex(/^[0-9A-Za-z]{22}$/);

/** "Elimina album": l'album e le foto che stanno solo lì vanno nel cestino. */
export async function trashAlbumAction(formData: FormData): Promise<void> {
  await requireOwner();
  const id = albumId.parse(formData.get("albumId"));
  const res = await trashAlbum(id);
  refreshGalleries();
  redirect(res ? `/album?album_cestino=${res.photos}` : "/album");
}

export async function restoreAlbumAction(formData: FormData): Promise<void> {
  await requireOwner();
  const id = albumId.parse(formData.get("albumId"));
  const ok = await restoreAlbum(id);
  refreshGalleries();
  redirect(ok ? `/album/${id}` : "/admin/cestino");
}

/** Elimina per sempre un album nel cestino con le sue foto (file compresi). */
export async function purgeAlbumAction(formData: FormData): Promise<void> {
  await requireOwner();
  if (formData.get("conferma") !== "si") redirect("/admin/cestino?errore=conferma");
  const id = albumId.parse(formData.get("albumId"));
  const res = await purgeAlbums({ publicIds: [id] });
  refreshGalleries();
  redirect(`/admin/cestino?eliminate=${res.photos}&errori=${res.failed}&album=${res.albums}`);
}
