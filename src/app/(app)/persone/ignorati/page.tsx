import Link from "next/link";
import { restoreIgnoredAction } from "@/app/actions/people";
import { parsePage } from "@/app/ui/gallery/views";
import { FaceGrid } from "@/app/ui/people/faces";
import { formatCount } from "@/lib/format";
import { signKeys } from "@/lib/gallery";
import { facesSummary, listIgnoredFaces } from "@/lib/people";
import { requireOwner } from "@/lib/session";

const FACES_PER_PAGE = 120;

export default async function IgnoredFacesPage({ searchParams }: PageProps<"/persone/ignorati">) {
  await requireOwner();
  const page = parsePage((await searchParams).pagina);
  const [faces, summary] = await Promise.all([
    listIgnoredFaces((page - 1) * FACES_PER_PAGE, FACES_PER_PAGE),
    facesSummary(),
  ]);
  const urls = await signKeys(faces.map((f) => f.face_key));
  const pages = Math.ceil(summary.ignored / FACES_PER_PAGE);

  return (
    <>
      <p>
        <Link href="/persone/da-riconoscere" prefetch={false}>
          ← Da riconoscere
        </Link>
      </p>
      <h1>Volti ignorati</h1>
      <p className="muted">
        {formatCount(summary.ignored)} {summary.ignored === 1 ? "volto messo" : "volti messi"} da parte con &quot;Non mi
        interessa&quot;, gli ultimi prima. Spunta quelli ignorati per errore e rimettili tra i volti da riconoscere: li
        trovi in cima, pronti per dargli un nome.
      </p>

      {faces.length === 0 ? (
        <p className="muted">Nessun volto ignorato.</p>
      ) : (
        <form action={restoreIgnoredAction}>
          <FaceGrid faces={faces} urls={urls} field="face" unchecked />
          <button type="submit">Rimetti tra i da riconoscere</button>
        </form>
      )}

      {pages > 1 && (
        <nav className="pager">
          {page > 1 ? <Link href={`/persone/ignorati?pagina=${page - 1}`}>← Precedenti</Link> : <span />}
          <span className="muted">
            Pagina {page} di {pages}
          </span>
          {page < pages ? <Link href={`/persone/ignorati?pagina=${page + 1}`}>Successivi →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
