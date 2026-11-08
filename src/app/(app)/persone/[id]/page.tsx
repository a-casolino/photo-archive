import Link from "next/link";
import { notFound } from "next/navigation";
import { deletePersonAction, mergePersonAction, removeFacesAction, renamePersonAction } from "@/app/actions/people";
import { ActionForm } from "@/app/ui/action-form";
import { Masonry } from "@/app/ui/gallery/masonry";
import { PAGE_SIZE, Pager, parsePage, photoItems } from "@/app/ui/gallery/views";
import { FaceGrid } from "@/app/ui/people/faces";
import { formatCount } from "@/lib/format";
import { signKeys } from "@/lib/gallery";
import { countPersonPhotos, getPerson, listPeople, personFaces, personPhotos } from "@/lib/people";
import { requireOwner } from "@/lib/session";

export default async function PersonPage({ params, searchParams }: PageProps<"/persone/[id]">) {
  await requireOwner();
  const { id } = await params;
  const person = await getPerson(id);
  if (!person) notFound();
  const page = parsePage((await searchParams).pagina);

  const [photos, total, faces, people] = await Promise.all([
    personPhotos(person.id, (page - 1) * PAGE_SIZE, PAGE_SIZE),
    countPersonPhotos(person.id),
    personFaces(person.id),
    listPeople(),
  ]);
  const urls = await signKeys([...photos.map((p) => p.thumb_key), ...faces.map((f) => f.face_key)]);
  const others = people.filter((p) => p.id !== person.id);

  return (
    <>
      <p>
        <Link href="/persone" prefetch={false}>
          ← Persone
        </Link>
      </p>
      <h1>{person.name}</h1>
      <p className="muted">
        {formatCount(total)} foto, in ordine di data.
      </p>

      {total > 0 ? (
        <>
          <Masonry items={photoItems(photos, urls, (pid) => `/foto/${pid}`, { badges: true })} />
          <Pager base={`/persone/${person.public_id}`} page={page} total={total} />
        </>
      ) : (
        <p className="muted">Nessuna foto confermata.</p>
      )}

      <details className="card owner-tools">
        <summary>Volti di {person.name} ({formatCount(faces.length)}{faces.length >= 120 ? "+" : ""})</summary>
        <p className="muted">Spunta i volti che non sono di {person.name} e toglili: non verranno più proposti per lei/lui.</p>
        <form action={removeFacesAction}>
          <input type="hidden" name="person" value={person.public_id} />
          <FaceGridUnchecked faces={faces} urls={urls} />
          <button type="submit" className="link danger">
            Togli i volti spuntati
          </button>
        </form>
      </details>

      <details className="card owner-tools">
        <summary>Rinomina, unisci o elimina</summary>
        <div style={{ maxWidth: 420 }}>
          <ActionForm action={renamePersonAction} submitLabel="Rinomina">
            <input type="hidden" name="person" value={person.public_id} />
            <label>
              Nome
              <input name="name" defaultValue={person.name} required maxLength={120} />
            </label>
          </ActionForm>

          {others.length > 0 && (
            <ActionForm action={mergePersonAction} submitLabel="Unisci">
              <input type="hidden" name="person" value={person.public_id} />
              <label>
                È la stessa persona di…
                <select name="into" required defaultValue="">
                  <option value="" disabled>
                    Scegli
                  </option>
                  {others.map((p) => (
                    <option key={p.public_id} value={p.public_id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </ActionForm>
          )}

          <form action={deletePersonAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="person" value={person.public_id} />
            <button type="submit" className="link danger">
              Elimina {person.name} e i suoi volti (le foto restano)
            </button>
          </form>
        </div>
      </details>
    </>
  );
}

/** Come FaceGrid, ma con le caselle vuote: si spuntano solo quelle da togliere. */
function FaceGridUnchecked(props: Parameters<typeof FaceGrid>[0]) {
  return <FaceGrid {...props} field="face" unchecked />;
}
