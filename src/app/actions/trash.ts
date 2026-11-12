"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/session";
import { queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { albumTreeIndex } from "@/lib/gallery";
import {
  purgeAlbums,
  purgePhotos,
  restoreAlbum,
  restorePhotoIds,
  restorePhotos,
  trashAlbum,
  trashImportPhotos,
  trashPhotos,
} from "@/lib/trash";
import { decodeUndo, encodeUndo, topmostSelected, UNDO_COOKIE, UNDO_MINUTES, type UndoTrash } from "@/lib/trash-rules";

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

/** Aggiunge un parametro a un percorso interno. */
function withParam(path: string, query: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

/** Ricorda cosa è appena andato nel cestino, per "Annulla" (o lo dimentica). */
async function rememberUndo(u: UndoTrash | null): Promise<void> {
  const jar = await cookies();
  const value = u ? encodeUndo(u) : null;
  if (!value) {
    jar.delete(UNDO_COOKIE);
    return;
  }
  jar.set(UNDO_COOKIE, value, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: UNDO_MINUTES * 60,
  });
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
  const moved = ids.length ? await trashPhotos(ids) : [];
  await rememberUndo(moved.length ? { kind: "photos", ids: moved } : null);
  refreshGalleries();
  redirect(moved.length ? withParam(back, `cestino=${ids.length}`) : back);
}

/** "Annulla" subito dopo uno spostamento nel cestino (foto o album). */
export async function undoTrashAction(formData: FormData): Promise<void> {
  await requireOwner();
  const back = safeBack(formData.get("back"), "/album");
  const jar = await cookies();
  const undo = decodeUndo(jar.get(UNDO_COOKIE)?.value);
  jar.delete(UNDO_COOKIE);
  let n = 0;
  if (undo?.kind === "photos") n = await restorePhotoIds(undo.ids);
  if (undo?.kind === "albums") {
    for (const id of undo.publicIds) if (await restoreAlbum(id)) n++;
  }
  refreshGalleries();
  redirect(withParam(back, `${undo?.kind === "albums" ? "album_ripristinati" : "ripristinate"}=${n}`));
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

/** "Elimina album": l'album, i sotto-album e le foto che stanno solo lì vanno nel cestino. */
export async function trashAlbumAction(formData: FormData): Promise<void> {
  await requireOwner();
  const id = albumId.parse(formData.get("albumId"));
  const back = safeBack(formData.get("back"), "/album");
  const res = await trashAlbum(id);
  await rememberUndo(res ? { kind: "albums", publicIds: [id] } : null);
  refreshGalleries();
  redirect(res ? withParam(back, `album_cestino=${res.photos}&sotto_album=${res.subalbums}`) : back);
}

/**
 * Più album insieme dall'elenco degli album. Un sotto-album scelto insieme
 * al suo album se ne va con lui.
 */
export async function trashAlbumsAction(formData: FormData): Promise<void> {
  await requireOwner();
  const ids = z.array(albumId).max(500).parse(formData.getAll("album").map(String));
  const back = safeBack(formData.get("back"), "/album");
  if (formData.get("conferma") !== "si" || !ids.length) redirect(back);
  const nodes = await albumTreeIndex();
  const byPublic = new Map(nodes.map((n) => [n.public_id, n]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chosen = topmostSelected(
    ids.map((pid) => byPublic.get(pid)?.id).filter((x): x is number => x !== undefined),
    (id) => byId.get(id)?.parent_id,
  );
  const done: string[] = [];
  let photos = 0;
  let subalbums = 0;
  for (const id of chosen) {
    const pid = byId.get(id)!.public_id;
    const res = await trashAlbum(pid);
    if (!res) continue;
    done.push(pid);
    photos += res.photos;
    subalbums += res.subalbums;
  }
  await rememberUndo(done.length ? { kind: "albums", publicIds: done } : null);
  refreshGalleries();
  redirect(
    done.length ? withParam(back, `album_cestino=${photos}&sotto_album=${subalbums}&album_n=${done.length}`) : back,
  );
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

/** Sposta nel cestino le foto entrate con un import finito (pagina dell'import). */
export async function trashImportPhotosAction(formData: FormData): Promise<void> {
  await requireOwner();
  const publicId = z.string().regex(/^[0-9A-Za-z]{22}$/).parse(formData.get("importId"));
  const imp = await queryOne<{ id: number; status: string }>("SELECT id, status FROM imports WHERE public_id = ?", [
    publicId,
  ]);
  if (!imp || imp.status === "running") redirect(`/admin/import/${publicId}`);
  const n = await trashImportPhotos(imp.id);
  refreshGalleries();
  revalidatePath("/admin/import");
  redirect(`/admin/import/${publicId}?cestino=${n}`);
}
