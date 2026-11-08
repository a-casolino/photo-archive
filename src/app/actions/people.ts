"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  confirmSuggestions,
  deletePerson,
  findOrCreatePerson,
  getPerson,
  ignoreCluster,
  mergePeople,
  nameCluster,
  PERSON_NAME_MAX,
  refreshPerson,
  rejectFaces,
  renamePerson,
} from "@/lib/people";
import { requireOwner } from "@/lib/session";
import type { FormState } from "@/lib/validation";

/* Persone e volti: solo il proprietario (requireOwner in ogni azione). */

const id = z.coerce.number().int().positive();
const publicId = z.string().regex(/^[0-9A-Za-z]{22}$/);
const personName = z
  .string()
  .trim()
  .min(1, { error: "Scrivi un nome." })
  .max(PERSON_NAME_MAX, { error: "Nome troppo lungo." })
  .transform((s) => s.replace(/\s+/g, " "));

/** Id dei volti spuntati (checkbox con lo stesso nome). */
function faceIds(formData: FormData, field: string): number[] {
  return formData
    .getAll(field)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 5000);
}

function refresh() {
  revalidatePath("/persone", "layout");
}

/**
 * Dà un nome a un gruppo di volti. Nel form ogni volto ha una casella
 * "è lui/lei" spuntata: quelli tolti restano senza nome.
 */
export async function nameClusterAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireOwner();
  const cluster = id.safeParse(formData.get("clusterId"));
  const name = personName.safeParse(formData.get("name"));
  if (!cluster.success) return { error: "Gruppo non valido." };
  if (!name.success) return { error: name.error.issues[0]?.message ?? "Nome non valido." };
  const shown = faceIds(formData, "shown");
  const kept = new Set(faceIds(formData, "keep"));
  const excluded = shown.filter((f) => !kept.has(f));

  const person = await findOrCreatePerson(name.data);
  const n = await nameCluster(cluster.data, person.id, excluded);
  await refreshPerson(person.id);
  refresh();
  return { ok: `${n} ${n === 1 ? "volto assegnato" : "volti assegnati"} a ${person.name}.` };
}

export async function ignoreClusterAction(formData: FormData): Promise<void> {
  await requireOwner();
  await ignoreCluster(id.parse(formData.get("clusterId")));
  refresh();
}

async function suggestionTarget(formData: FormData) {
  const person = await getPerson(publicId.parse(formData.get("person")));
  return person ? { person, faces: faceIds(formData, "face") } : null;
}

/** Conferma i suggerimenti spuntati di una persona. */
export async function confirmSuggestionsAction(formData: FormData): Promise<void> {
  await requireOwner();
  const t = await suggestionTarget(formData);
  if (!t) return;
  await confirmSuggestions(t.person.id, t.faces);
  await refreshPerson(t.person.id);
  refresh();
}

/** Scarta i suggerimenti spuntati: "non è lei/lui". */
export async function rejectSuggestionsAction(formData: FormData): Promise<void> {
  await requireOwner();
  const t = await suggestionTarget(formData);
  if (!t) return;
  await rejectFaces(t.person.id, t.faces, "suggested");
  refresh();
}

/** Toglie dalla persona i volti confermati per errore. */
export async function removeFacesAction(formData: FormData): Promise<void> {
  await requireOwner();
  const person = await getPerson(publicId.parse(formData.get("person")));
  if (!person) return;
  await rejectFaces(person.id, faceIds(formData, "face"), "confirmed");
  await refreshPerson(person.id);
  refresh();
}

export async function renamePersonAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireOwner();
  const person = await getPerson(publicId.parse(formData.get("person")));
  if (!person) return { error: "Persona non trovata." };
  const name = personName.safeParse(formData.get("name"));
  if (!name.success) return { error: name.error.issues[0]?.message ?? "Nome non valido." };
  const res = await renamePerson(person.id, name.data);
  if ("error" in res) return { error: res.error };
  refresh();
  return { ok: "Nome cambiato." };
}

export async function mergePersonAction(_: FormState, formData: FormData): Promise<FormState> {
  await requireOwner();
  const from = await getPerson(publicId.parse(formData.get("person")));
  const into = await getPerson(String(formData.get("into") ?? ""));
  if (!from || !into) return { error: "Scegli la persona con cui unire." };
  if (from.id === into.id) return { error: "È la stessa persona." };
  await mergePeople(from.id, into.id);
  refresh();
  redirect(`/persone/${into.public_id}`);
}

export async function deletePersonAction(formData: FormData): Promise<void> {
  await requireOwner();
  const person = await getPerson(publicId.parse(formData.get("person")));
  if (person) await deletePerson(person.id);
  refresh();
  redirect("/persone");
}
