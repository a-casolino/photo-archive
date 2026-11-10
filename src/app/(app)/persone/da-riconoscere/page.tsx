import Link from "next/link";
import { ignoreClusterAction, nameClusterAction } from "@/app/actions/people";
import { ActionForm } from "@/app/ui/action-form";
import { FaceGrid, PeopleTabs } from "@/app/ui/people/faces";
import { parsePage } from "@/app/ui/gallery/views";
import { formatCount } from "@/lib/format";
import { signKeys } from "@/lib/gallery";
import { facesSummary, listClusters, listPeople } from "@/lib/people";
import { requireOwner } from "@/lib/session";

const CLUSTERS_PER_PAGE = 20;

export default async function UnknownFacesPage({ searchParams }: PageProps<"/persone/da-riconoscere">) {
  await requireOwner();
  const sp = await searchParams;
  const page = parsePage(sp.pagina);
  // Gruppo da mostrare per primo (volti appena ripristinati dagli ignorati).
  const first = page === 1 ? Number(sp.gruppo) || 0 : 0;
  const [clusters, summary, people] = await Promise.all([
    listClusters((page - 1) * CLUSTERS_PER_PAGE, CLUSTERS_PER_PAGE, 18, first),
    facesSummary(),
    listPeople(),
  ]);
  const urls = await signKeys(clusters.flatMap((c) => c.faces.map((f) => f.face_key)));
  const pages = Math.ceil(summary.groups / CLUSTERS_PER_PAGE);

  return (
    <>
      <h1>Persone</h1>
      <PeopleTabs current="gruppi" groups={summary.groups} suggested={summary.suggested} />
      <p className="muted">
        Volti senza nome raggruppati per somiglianza, dal gruppo più grande. Scrivi un nome (nuovo o di una persona che
        esiste già) e vale per tutto il gruppo; togli la spunta ai volti che non c&apos;entrano. I gruppi si aggiornano a
        ogni <code>npm run volti</code>.
      </p>

      <datalist id="people-names">
        {people.map((p) => (
          <option key={p.public_id} value={p.name} />
        ))}
      </datalist>

      {clusters.length === 0 ? (
        <p className="muted">Nessun volto da riconoscere.</p>
      ) : (
        clusters.map((c) => (
          <section key={c.cluster_id} className="card cluster">
            <h2>
              {c.cluster_id === first && <span className="muted">Ripristinati: </span>}
              {formatCount(c.size)} {c.size === 1 ? "volto" : "volti"}
              {c.size > c.faces.length && <span className="muted"> (ne vedi {c.faces.length})</span>}
            </h2>
            <ActionForm action={nameClusterAction} submitLabel="Dai il nome">
              <input type="hidden" name="clusterId" value={c.cluster_id} />
              <FaceGrid faces={c.faces} urls={urls} field="keep" shownField="shown" />
              <label>
                Chi è?
                <input name="name" list="people-names" required maxLength={120} autoComplete="off" />
              </label>
            </ActionForm>
            <form action={ignoreClusterAction} className="cluster-ignore">
              <input type="hidden" name="clusterId" value={c.cluster_id} />
              <button type="submit" className="link">
                Non mi interessa (sconosciuti): non proporre più questo gruppo
              </button>
            </form>
          </section>
        ))
      )}

      {pages > 1 && (
        <nav className="pager">
          {page > 1 ? <Link href={`/persone/da-riconoscere?pagina=${page - 1}`}>← Precedenti</Link> : <span />}
          <span className="muted">
            Pagina {page} di {pages}
          </span>
          {page < pages ? <Link href={`/persone/da-riconoscere?pagina=${page + 1}`}>Successivi →</Link> : <span />}
        </nav>
      )}

      {summary.ignored > 0 && (
        <p className="muted">
          <Link href="/persone/ignorati" prefetch={false}>
            Volti ignorati ({formatCount(summary.ignored)})
          </Link>
          : quelli messi da parte con &quot;Non mi interessa&quot;, da rimettere qui se li hai ignorati per errore.
        </p>
      )}
    </>
  );
}
