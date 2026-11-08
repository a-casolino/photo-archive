import Link from "next/link";
import { PeopleTabs } from "@/app/ui/people/faces";
import { formatCount } from "@/lib/format";
import { signKeys } from "@/lib/gallery";
import { facesSummary, listPeople } from "@/lib/people";
import { requireOwner } from "@/lib/session";

export default async function PeoplePage() {
  await requireOwner();
  const [people, summary] = await Promise.all([listPeople(), facesSummary()]);
  const urls = await signKeys(people.map((p) => p.cover_key));

  return (
    <>
      <h1>Persone</h1>
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
