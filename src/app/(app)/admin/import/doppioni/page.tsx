import Link from "next/link";
import { discardDuplicate, keepBothDuplicates } from "@/app/actions/imports";
import { countDuplicatePairs, listDuplicatePairs, type DuplicateSide } from "@/lib/duplicates";
import { dateTimeFmt, formatBytes, formatCount, formatTakenAt } from "@/lib/format";
import { requireOwner } from "@/lib/session";
import { storage } from "@/lib/storage";

/*
 * Probabili doppioni tra i CR2: stesso scatto (fotocamera, istante, numero
 * di file Canon) ma file diversi. Si sceglie quale tenere, oppure si dice
 * che sono foto diverse.
 */

function Side({
  p,
  other,
  url,
  label,
}: {
  p: DuplicateSide;
  other: DuplicateSide;
  url: string | undefined;
  label: string;
}) {
  return (
    <div className="match-photo">
      <span className="muted">{label}</span>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL firmati temporanei, niente ottimizzazione
        <img src={url} alt={p.name} loading="lazy" />
      ) : (
        <div className="no-thumb">senza anteprima</div>
      )}
      <strong>{p.name}</strong>
      <span className="muted">
        {formatTakenAt(p.taken_at, p.subsec)}
        {p.file_number && ` · n. ${p.file_number}`}
      </span>
      <span className="muted">
        {formatBytes(p.size)} · {p.import_label ?? "import ?"} · {dateTimeFmt.format(p.created_at)}
      </span>
      {p.path && <span className="current-file">{p.path}</span>}
      <form action={discardDuplicate}>
        <input type="hidden" name="discard" value={p.pid} />
        <input type="hidden" name="keep" value={other.pid} />
        <button type="submit" className="secondary">
          Scarta questa
        </button>
      </form>
    </div>
  );
}

export default async function DuplicatesPage() {
  await requireOwner();
  const [pairs, total] = await Promise.all([listDuplicatePairs(30), countDuplicatePairs()]);

  const s = storage();
  const urls = new Map<string, string>();
  await Promise.all(
    pairs
      .flatMap((p) => [p.a, p.b])
      .map(async (p) => {
        if (p.thumb && !urls.has(p.thumb)) urls.set(p.thumb, await s.readUrl(p.thumb));
      }),
  );

  return (
    <>
      <p>
        <Link prefetch={false} href="/admin/import">
          ← Import
        </Link>
      </p>
      <h1>Probabili doppioni</h1>
      <p className="muted">
        CR2 con file diversi ma che sembrano lo stesso scatto: stessa fotocamera, stesso istante e stesso numero di file
        Canon (o, se manca, stesso nome). I file identici non arrivano qui: l&apos;import li salta già. Scartare una
        foto la mette nel cestino; i suoi album e gli export collegati passano a quella che tieni.
      </p>

      <section className="card">
        <h2>Da rivedere ({formatCount(total)})</h2>
        {pairs.length === 0 ? (
          <p className="muted">Nessun probabile doppione.</p>
        ) : (
          <div className="match-list">
            {pairs.map(({ a, b }) => (
              <div key={`${a.pid}-${b.pid}`} className="match-row">
                <Side p={a} other={b} url={a.thumb ? urls.get(a.thumb) : undefined} label="Prima importata" />
                <Side p={b} other={a} url={b.thumb ? urls.get(b.thumb) : undefined} label="Importata dopo" />
                <form action={keepBothDuplicates} style={{ alignSelf: "center" }}>
                  <input type="hidden" name="a" value={a.pid} />
                  <input type="hidden" name="b" value={b.pid} />
                  <button type="submit">Sono foto diverse, tienile</button>
                </form>
              </div>
            ))}
          </div>
        )}
        {total > pairs.length && <p className="muted">Sono mostrate le prime {pairs.length} coppie.</p>}
      </section>
    </>
  );
}
