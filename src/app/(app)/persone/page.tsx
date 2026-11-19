import { cookies } from "next/headers";
import Link from "next/link";
import { PeopleTabs } from "@/app/ui/people/faces";
import { SortSelect } from "@/app/ui/sort-select";
import { formatCount } from "@/lib/format";
import { signKeys } from "@/lib/gallery";
import { facesSummary, listPeople } from "@/lib/people";
import { PEOPLE_SORT_COOKIE, PEOPLE_SORT_LABEL, PEOPLE_SORTS, parsePeopleSort, sortPeople } from "@/lib/people-sort";
import { requireOwner } from "@/lib/session";

export default async function PeoplePage() {
  await requireOwner();
  const [list, summary, jar] = await Promise.all([listPeople(), facesSummary(), cookies()]);
  // Ordine scelto dal proprietario (alfabetico se non ha scelto): in memoria, i conteggi ci sono già.
  const sort = parsePeopleSort(jar.get(PEOPLE_SORT_COOKIE)?.value);
  const people = sortPeople(list, sort);
  const urls = await signKeys(people.map((p) => p.cover_key));

  return (
    <>
      <div className="page-head">
        <h1>Persone</h1>
        {people.length > 1 && (
          <SortSelect
            className="album-sort"
            label="Ordina persone"
            cookie={PEOPLE_SORT_COOKIE}
            value={sort}
            options={PEOPLE_SORTS.map((s) => ({ value: s, label: PEOPLE_SORT_LABEL[s] }))}
          />
        )}
      </div>
      <PeopleTabs current="persone" groups={summary.groups} suggested={summary.suggested} />
      <p className="muted">
        Foto analizzate: {formatCount(summary.scanned)}
        {summary.pending > 0 && <> · da analizzare: {formatCount(summary.pending)} (sulla VPS: npm run volti)</>}. Volti e
        nomi li vedi solo tu.
      </p>

      {people.length === 0 ? (
        <p className="muted">
          Nessuna persona con un nome. Apri <Link href="/persone/da-riconoscere">Da riconoscere</Link> e dai un nome ai
          gruppi di volti.
        </p>
      ) : (
        <ul className="people-grid">
          {people.map((p) => {
            const src = p.cover_key ? urls.get(p.cover_key) : undefined;
            return (
              <li key={p.public_id}>
                <Link href={`/persone/${p.public_id}`} prefetch={false}>
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL firmati temporanei
                    <img src={src} alt="" width={120} height={120} />
                  ) : (
                    <span className="face-empty" />
                  )}
                  <strong>{p.name}</strong>
                  <span className="muted">
                    {formatCount(p.photo_count)} foto
                    {p.suggested_count > 0 && ` · ${formatCount(p.suggested_count)} da confermare`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
