import Link from "next/link";
import { confirmAllSuggestionsAction, confirmSuggestionsAction, rejectSuggestionsAction } from "@/app/actions/people";
import { FaceGrid, PeopleTabs } from "@/app/ui/people/faces";
import { formatCount } from "@/lib/format";
import { signKeys } from "@/lib/gallery";
import { facesSummary, listSuggestions } from "@/lib/people";
import { requireOwner } from "@/lib/session";
import { Button } from "@/components/ui/button";

export default async function SuggestionsPage() {
  await requireOwner();
  const [groups, summary] = await Promise.all([listSuggestions(), facesSummary()]);
  const urls = await signKeys(groups.flatMap((g) => g.faces.map((f) => f.face_key)));

  return (
    <>
      <h1>Persone</h1>
      <PeopleTabs current="suggerimenti" groups={summary.groups} suggested={summary.suggested} />
      <p className="muted">
        Volti che somigliano a una persona che hai già nominato, i più sicuri prima. Nulla viene assegnato senza la tua
        conferma: togli la spunta a quelli sbagliati e conferma, oppure spunta solo quelli sbagliati e scartali. In
        tutti e due i casi i volti sbagliati non verranno più proposti per quella persona. Quando una persona ha più
        suggerimenti di quelli mostrati, &ldquo;Conferma tutti&rdquo; conferma anche quelli che non vedi (tranne quelli a cui
        hai tolto la spunta).
      </p>

      {groups.length === 0 ? (
        <p className="muted">Nessun suggerimento. Arrivano quando analizzi foto nuove o lanci npm run volti -- --raggruppa.</p>
      ) : (
        groups.map(({ person, total, faces }) => (
          <section key={person.public_id} className="card cluster">
            <h2>
              Forse è <Link href={`/persone/${person.public_id}`}>{person.name}</Link>?{" "}
              <span className="muted">
                {formatCount(total)} {total === 1 ? "volto" : "volti"}
                {total > faces.length && `, ne vedi ${faces.length}`}
              </span>
            </h2>
            <form>
              <input type="hidden" name="person" value={person.public_id} />
              <FaceGrid faces={faces} urls={urls} field="face" shownField="shown" />
              <div className="share-actions">
                <Button type="submit" formAction={confirmSuggestionsAction}>
                  Sì, conferma le spuntate
                </Button>
                {total > faces.length && (
                  <Button type="submit" variant="outline" formAction={confirmAllSuggestionsAction}>
                    Sì, conferma tutti i {formatCount(total)}
                  </Button>
                )}
                <Button type="submit" variant="danger" formAction={rejectSuggestionsAction}>
                  No, scarta le spuntate
                </Button>
              </div>
            </form>
          </section>
        ))
      )}
    </>
  );
}
