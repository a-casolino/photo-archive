"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { newToken, randomBase62 } from "@/lib/crypto";
import { execute, queryOne } from "@/lib/db";
import { groupTakeoutExports } from "@/lib/drive-rules";
import { env } from "@/lib/env";
import { dateTimeFmt } from "@/lib/format";
import {
  disconnectDrive,
  DRIVE_CALLBACK_PATH,
  DRIVE_STATE_COOKIE,
  driveAuthUrl,
  driveConfigured,
  DriveClient,
  FOLDER_MIME,
} from "@/lib/google-drive";
import { requireOwner } from "@/lib/session";
import { listTakeoutFiles } from "@/lib/drive-browse";

const PAGE = "/admin/import/drive";

/** Porta il proprietario alla pagina di consenso di Google. */
export async function startDriveConnection(): Promise<void> {
  await requireOwner();
  if (!driveConfigured()) redirect(`${PAGE}?errore=config`);
  const state = newToken();
  (await cookies()).set(DRIVE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: DRIVE_CALLBACK_PATH,
    maxAge: 600,
  });
  redirect(driveAuthUrl(state));
}

export async function disconnectDriveAction(): Promise<void> {
  const owner = await requireOwner();
  await disconnectDrive(owner.id);
  revalidatePath(PAGE);
}

async function client(): Promise<DriveClient> {
  const c = await DriveClient.forOwner();
  if (!c) redirect(`${PAGE}?errore=scollegato`);
  return c;
}

async function enqueue(kind: "takeout" | "folder", label: string, ids: string[], ownerId: number) {
  const dup = await queryOne<{ id: number }>(
    `SELECT id FROM drive_imports
      WHERE kind = ? AND JSON_CONTAINS(drive_ids, JSON_ARRAY(?)) AND status IN ('queued', 'running')`,
    [kind, ids[0]],
  );
  if (dup) return;
  await execute(
    "INSERT INTO drive_imports (public_id, kind, label, drive_ids, created_by) VALUES (?, ?, ?, ?, ?)",
    [randomBase62(22), kind, label.slice(0, 255), JSON.stringify(ids), ownerId],
  );
}

/** Mette in coda tutti gli zip di un export di Takeout (ricercati di nuovo su Drive). */
export async function queueTakeoutExport(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const key = z.string().regex(/^takeout-\d{8}t\d{6}z$/).parse(formData.get("key"));
  const exp = groupTakeoutExports(await listTakeoutFiles(await client())).find((g) => g.key === key);
  if (!exp || exp.tgz) redirect(`${PAGE}?errore=takeout`);
  await enqueue(
    "takeout",
    `Takeout del ${dateTimeFmt.format(exp.createdAt)}`,
    exp.parts.map((p) => p.id),
    owner.id,
  );
  revalidatePath(PAGE);
}

/** Mette in coda una cartella di Drive, con le sottocartelle. */
export async function queueDriveFolder(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const id = z.string().regex(/^[A-Za-z0-9_-]{5,200}$/).parse(formData.get("folderId"));
  const folder = await (await client()).file(id).catch(() => null);
  if (!folder || folder.mimeType !== FOLDER_MIME) redirect(`${PAGE}?errore=cartella`);
  await enqueue("folder", folder.name, [folder.id], owner.id);
  revalidatePath(PAGE);
}

const publicId = z.string().length(22);

export async function cancelDriveImport(formData: FormData): Promise<void> {
  await requireOwner();
  await execute(
    `UPDATE drive_imports SET status = 'cancelled', finished_at = UTC_TIMESTAMP(), message = 'Annullato'
      WHERE public_id = ? AND status IN ('queued', 'running')`,
    [publicId.parse(formData.get("id"))],
  );
  revalidatePath(PAGE);
}

/** Rimette in coda un import fallito o annullato: riparte dal primo lotto non finito. */
export async function retryDriveImport(formData: FormData): Promise<void> {
  await requireOwner();
  await execute(
    `UPDATE drive_imports SET status = 'queued', finished_at = NULL, message = NULL
      WHERE public_id = ? AND status IN ('failed', 'cancelled')`,
    [publicId.parse(formData.get("id"))],
  );
  revalidatePath(PAGE);
}

/**
 * Mette in coda la verifica di un export di Takeout già importato: la VPS
 * rilegge l'indice degli zip e confronta album per album con l'archivio.
 */
export async function queueTakeoutCheck(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const key = z.string().regex(/^takeout-\d{8}t\d{6}z$/).parse(formData.get("key"));
  const exp = groupTakeoutExports(await listTakeoutFiles(await client())).find((g) => g.key === key);
  if (!exp || exp.tgz) redirect(`${PAGE}?errore=takeout`);
  const ids = exp.parts.map((p) => p.id);
  const dup = await queryOne<{ id: number }>(
    `SELECT id FROM drive_checks WHERE JSON_CONTAINS(drive_ids, JSON_ARRAY(?)) AND status IN ('queued', 'running')`,
    [ids[0]],
  );
  if (!dup) {
    await execute("INSERT INTO drive_checks (public_id, label, drive_ids, created_by) VALUES (?, ?, ?, ?)", [
      randomBase62(22),
      `Takeout del ${dateTimeFmt.format(exp.createdAt)}`,
      JSON.stringify(ids),
      owner.id,
    ]);
  }
  revalidatePath(PAGE);
}
