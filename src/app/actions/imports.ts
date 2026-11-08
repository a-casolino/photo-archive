"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { execute, query, queryOne } from "@/lib/db";
import { autoMatch, createDevice, STALE_AFTER_MS } from "@/lib/imports";
import { requireOwner } from "@/lib/session";
import { firstError } from "@/lib/validation";

export type NewDeviceState = { error?: string; token?: string; name?: string } | undefined;

const deviceName = z.string().trim().min(1, { error: "Dai un nome al computer." }).max(120);

/** Crea una chiave per il programma di import. La chiave si vede una volta sola. */
export async function createDeviceKey(_: NewDeviceState, formData: FormData): Promise<NewDeviceState> {
  const owner = await requireOwner();
  const parsed = deviceName.safeParse(formData.get("name"));
  if (!parsed.success) return { error: firstError(parsed.error) };
  const token = await createDevice(parsed.data, owner.id);
  revalidatePath("/admin/import");
  return { token, name: parsed.data };
}

export async function revokeDeviceKey(formData: FormData): Promise<void> {
  await requireOwner();
  const id = z.coerce.number().int().positive().parse(formData.get("deviceId"));
  await execute("UPDATE import_devices SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND revoked_at IS NULL", [id]);
  revalidatePath("/admin/import");
}

/** Segna come interrotto un import che non dà più segnali (programma chiuso male). */
export async function markImportInterrupted(formData: FormData): Promise<void> {
  await requireOwner();
  const publicId = z.string().length(22).parse(formData.get("importId"));
  await execute(
    `UPDATE imports SET status = 'interrupted', finished_at = UTC_TIMESTAMP(), current_file = NULL, activity_json = NULL
      WHERE public_id = ? AND status = 'running'
        AND COALESCE(last_seen_at, started_at) < UTC_TIMESTAMP() - INTERVAL ? SECOND`,
    [publicId, STALE_AFTER_MS / 1000],
  );
  revalidatePath("/admin/import");
}

// ---------------------------------------------------------------------
// Revisione dei collegamenti export -> CR2
// ---------------------------------------------------------------------

const decision = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("confirm"), edit: z.string().length(22) }),
  z.object({ decision: z.literal("reject"), edit: z.string().length(22) }),
  z.object({ decision: z.literal("choose"), edit: z.string().length(22), raw: z.string().length(22) }),
]);

export async function decideMatch(formData: FormData): Promise<void> {
  await requireOwner();
  const d = decision.parse(Object.fromEntries(formData));
  const edit = await queryOne<{ id: number }>(
    "SELECT id FROM photos WHERE public_id = ? AND kind = 'edit' AND deleted_at IS NULL",
    [d.edit],
  );
  if (!edit) return;

  if (d.decision === "confirm") {
    await execute(
      "UPDATE photos SET match_status = 'confirmed' WHERE id = ? AND derived_from_id IS NOT NULL",
      [edit.id],
    );
  } else if (d.decision === "reject") {
    // "Nessuno di questi": l'export resta senza originale e non viene più proposto.
    await execute(
      "UPDATE photos SET derived_from_id = NULL, match_status = 'rejected', match_method = 'manual' WHERE id = ?",
      [edit.id],
    );
  } else {
    const raw = await queryOne<{ id: number }>(
      "SELECT id FROM photos WHERE public_id = ? AND kind = 'raw' AND deleted_at IS NULL",
      [d.raw],
    );
    if (!raw) return;
    await execute(
      "UPDATE photos SET derived_from_id = ?, match_status = 'confirmed', match_method = 'manual' WHERE id = ?",
      [raw.id, edit.id],
    );
  }
  revalidatePath("/admin/import/collegamenti");
  revalidatePath("/admin/import");
}

export async function confirmAllAuto(): Promise<void> {
  await requireOwner();
  await execute("UPDATE photos SET match_status = 'confirmed' WHERE kind = 'edit' AND match_status = 'auto'");
  revalidatePath("/admin/import/collegamenti");
  revalidatePath("/admin/import");
}

export async function rerunMatching(): Promise<void> {
  await requireOwner();
  await autoMatch();
  revalidatePath("/admin/import/collegamenti");
  revalidatePath("/admin/import");
}

// ---------------------------------------------------------------------
// Probabili doppioni
// ---------------------------------------------------------------------

const pairForm = z.object({ a: z.string().length(22), b: z.string().length(22) });

async function rawIds(a: string, b: string) {
  const rows = await query<{ id: number; public_id: string }>(
    "SELECT id, public_id FROM photos WHERE public_id IN (?, ?) AND kind = 'raw' AND deleted_at IS NULL",
    [a, b],
  );
  const byPid = new Map(rows.map((r) => [r.public_id, Number(r.id)]));
  const ia = byPid.get(a);
  const ib = byPid.get(b);
  return ia && ib && ia !== ib ? { a: ia, b: ib } : null;
}

/** "Sono foto diverse": la coppia non viene più proposta. */
export async function keepBothDuplicates(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const p = pairForm.parse(Object.fromEntries(formData));
  const ids = await rawIds(p.a, p.b);
  if (!ids) return;
  await execute("INSERT IGNORE INTO duplicate_dismissals (photo_a, photo_b, decided_by) VALUES (?, ?, ?)", [
    Math.min(ids.a, ids.b),
    Math.max(ids.a, ids.b),
    owner.id,
  ]);
  revalidatePath("/admin/import/doppioni");
  revalidatePath("/admin/import");
}

/**
 * Scarta il doppione: va nel cestino (deleted_at), i suoi album e gli
 * export collegati passano alla foto tenuta.
 */
export async function discardDuplicate(formData: FormData): Promise<void> {
  await requireOwner();
  const p = z.object({ discard: z.string().length(22), keep: z.string().length(22) }).parse(Object.fromEntries(formData));
  const ids = await rawIds(p.discard, p.keep);
  if (!ids) return;
  const [discard, keep] = [ids.a, ids.b];
  await execute(
    `INSERT IGNORE INTO album_photos (album_id, photo_id, position)
     SELECT album_id, ?, position FROM album_photos WHERE photo_id = ?`,
    [keep, discard],
  );
  await execute("DELETE FROM album_photos WHERE photo_id = ?", [discard]);
  await execute("UPDATE albums SET cover_photo_id = ? WHERE cover_photo_id = ?", [keep, discard]);
  await execute("UPDATE photos SET derived_from_id = ? WHERE derived_from_id = ?", [keep, discard]);
  await execute("UPDATE photos SET deleted_at = UTC_TIMESTAMP() WHERE id = ?", [discard]);
  revalidatePath("/admin/import/doppioni");
  revalidatePath("/admin/import");
}
