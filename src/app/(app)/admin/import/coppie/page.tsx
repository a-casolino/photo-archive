import Link from "next/link";
import {
  confirmSurePairs,
  decideAlbumPair,
  mergeAlbumPairAction,
  mergeAllConfirmedPairs,
  recomputeAlbumPairs,
} from "@/app/actions/album-pairs";
import { PAIR_MIN_SHARE, PAIR_SURE_SHARE } from "@/lib/album-pair-rules";
import { query } from "@/lib/db";
import { formatCount } from "@/lib/format";
import { requireOwner } from "@/lib/session";
import { storage } from "@/lib/storage";

/*
 * Coppie album Google ↔ cartella del disco (passo 2 dell'unione degli album,
 * richiesta di Antonio del 2026-11-16). Qui si confermano o si scartano;
 * l'unione vera è un passo successivo.
 */

type PairRow = {
  g_pid: string;
  g_title: string;
  g_thumb: string | null;
  f_pid: string;
  f_title: string;
  f_parent: string | null;
  f_thumb: string | null;
  f_photos: number;
  shared_photos: number;
  album_photos: number;
  status: "proposed" | "confirmed" | "rejected";
};

type Group = { g_pid: string; g_title: string; g_thumb: string | null; album_photos: number; folders: PairRow[] };

function percent(n: number, d: number) {
  return d ? `${Math.round((n / d) * 100)}%` : "–";
}

function group(rows: PairRow[]): Group[] {
  const out = new Map<string, Group>();
  for (const r of rows) {
    const g = out.get(r.g_pid) ?? { g_pid: r.g_pid, g_title: r.g_title, g_thumb: r.g_thumb, album_photos: 0, folders: [] };
    g.album_photos = Number(r.album_photos);
    g.folders.push(r);
    out.set(r.g_pid, g);
  }
  return [...out.values()];
}

function Cover({ thumb, title, urls }: { thumb: string | null; title: string; urls: Map<string, string> }) {
  const url = thumb ? urls.get(thumb) : undefined;
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- URL firmati temporanei, niente ottimizzazione
    <img src={url} alt={title} loading="lazy" />
  ) : (
    <div className="no-thumb">senza copertina</div>
  );
}

function PairButtons({ g, f, status }: { g: string; f: string; status: PairRow["status"] }) {
  const button = (decision: string, label: string, secondary = false) => (
    <form action={decideAlbumPair}>
      <input type="hidden" name="google" value={g} />
      <input type="hidden" name="folder" value={f} />
      <input type="hidden" name="decision" value={decision} />
      <button type="submit" className={secondary ? "secondary" : undefined}>
        {label}
      </button>
    </form>
  );
  return (
    <div className="actions">
      {status === "proposed" && button("confirm", "Conferma")}
      {status === "proposed" && button("reject", "Non è questa", true)}
      {status !== "proposed" && button("reset", "Rimetti da decidere", true)}
    </div>
  );
}

function GroupRow({ g, urls, merge = false }: { g: Group; urls: Map<string, string>; merge?: boolean }) {
  return (
    <div className="match-row">
      <div className="match-photo">
        <span className="muted">Album Google</span>
        <Cover thumb={g.g_thumb} title={g.g_title} urls={urls} />
        <Link prefetch={false} href={`/album/${g.g_pid}`}>
          <strong>{g.g_title}</strong>
        </Link>
        <span className="muted">{formatCount(g.album_photos)} foto</span>
      </div>
      <span className="match-arrow" aria-hidden>
        →
      </span>
      {g.folders.map((f) => (
        <div key={f.f_pid} className="match-photo">
          <span className="muted">Cartella del disco</span>
          <Cover thumb={f.f_thumb} title={f.f_title} urls={urls} />
          <Link prefetch={false} href={`/album/${f.f_pid}`}>
            <strong>
              {f.f_parent ? `${f.f_parent} › ` : ""}
              {f.f_title}
            </strong>
          </Link>
          <span className="muted">
            {formatCount(Number(f.shared_photos))} foto dell&apos;album su {formatCount(g.album_photos)} (
            {percent(Number(f.shared_photos), g.album_photos)}) · {formatCount(Number(f.f_photos))} foto nella cartella
          </span>
          <PairButtons g={g.g_pid} f={f.f_pid} status={f.status} />
        </div>
      ))}
      {merge && (
        <form action={mergeAlbumPairAction} style={{ alignSelf: "center" }}>
          <input type="hidden" name="google" value={g.g_pid} />
          <button type="submit">Unisci</button>
        </form>
      )}
    </div>
  );
}

export default async function AlbumPairsPage() {
  await requireOwner();

  const rows = await query<PairRow>(
    `SELECT g.public_id AS g_pid, g.title AS g_title, gc.gcs_thumb_key AS g_thumb,
            f.public_id AS f_pid, f.title AS f_title, fp.title AS f_parent, fc.gcs_thumb_key AS f_thumb,
            (SELECT COUNT(*) FROM album_photos x JOIN photos p ON p.id = x.photo_id AND p.deleted_at IS NULL
              WHERE x.album_id = f.id) AS f_photos,
            ap.shared_photos, ap.album_photos, ap.status
       FROM album_pairs ap
       JOIN albums g ON g.id = ap.google_album_id AND g.deleted_at IS NULL
       JOIN albums f ON f.id = ap.folder_album_id AND f.deleted_at IS NULL
       LEFT JOIN albums fp ON fp.id = f.parent_id
       LEFT JOIN photos gc ON gc.id = g.cover_photo_id
       LEFT JOIN photos fc ON fc.id = f.cover_photo_id
      ORDER BY ap.shared_photos / ap.album_photos DESC, g.title, ap.shared_photos DESC`,
  );
  const [mergedRow] = await query<{ n: number }>(
    "SELECT COUNT(DISTINCT google_album_id) AS n FROM album_pairs WHERE merged_at IS NOT NULL",
  );
  const unpaired = await query<{ public_id: string; title: string; n: number }>(
    `SELECT a.public_id, a.title,
            (SELECT COUNT(*) FROM album_photos x JOIN photos p ON p.id = x.photo_id AND p.deleted_at IS NULL
              WHERE x.album_id = a.id) AS n
       FROM albums a
      WHERE a.origin = 'google_photos' AND a.parent_id IS NULL AND a.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM album_pairs ap WHERE ap.google_album_id = a.id AND ap.status <> 'rejected')
      ORDER BY a.title`,
  );

  const proposed = group(rows.filter((r) => r.status === "proposed"));
  // Le coppie già unite non compaiono: la cartella è nel cestino.
  const confirmed = group(rows.filter((r) => r.status === "confirmed"));
  const rejected = group(rows.filter((r) => r.status === "rejected"));
  const sure = rows.filter(
    (r) => r.status === "proposed" && Number(r.shared_photos) >= Number(r.album_photos) * PAIR_SURE_SHARE,
  ).length;

  const s = storage();
  const urls = new Map<string, string>();
  await Promise.all(
    [...new Set(rows.flatMap((r) => [r.g_thumb, r.f_thumb]).filter((k): k is string => !!k))].map(async (k) =>
      urls.set(k, await s.readUrl(k)),
    ),
  );

  return (
    <>
      <p>
        <Link prefetch={false} href="/admin/import">← Import</Link>
      </p>
      <h1>Coppie album Google ↔ cartella del disco</h1>
      <p className="muted">
        Ogni album di Google Foto o Drive è una selezione di un evento; gli originali stanno in una cartella del disco.
        Una cartella è proposta se contiene almeno il {Math.round(PAIR_MIN_SHARE * 100)}% delle foto dell&apos;album
        (come CR2 collegato o come scatto con la stessa fotocamera e lo stesso istante). Un evento su due giorni può
        avere due cartelle; ogni cartella va a un solo album. Confermare non sposta niente: l&apos;unione degli album
        è il passo successivo.
      </p>
      <form action={recomputeAlbumPairs} className="actions">
        <button type="submit" className="secondary">
          {rows.length ? "Ricalcola le proposte" : "Calcola le proposte"}
        </button>
        <span className="muted">Le coppie già confermate o scartate restano come sono.</span>
      </form>

      <section className="card">
        <div className="import-head">
          <h2>Da confermare ({formatCount(proposed.length)} album)</h2>
          {sure > 0 && (
            <form action={confirmSurePairs}>
              <button type="submit">
                Conferma le {formatCount(sure)} sopra il {Math.round(PAIR_SURE_SHARE * 100)}%
              </button>
            </form>
          )}
        </div>
        {proposed.length === 0 ? (
          <p className="muted">{rows.length ? "Niente da confermare." : "Nessuna proposta: premi «Calcola le proposte»."}</p>
        ) : (
          <div className="match-list">
            {proposed.map((g) => (
              <GroupRow key={g.g_pid} g={g} urls={urls} />
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="import-head">
          <h2>Confermate, da unire ({formatCount(confirmed.length)} album)</h2>
          {confirmed.length > 0 && (
            <form action={mergeAllConfirmedPairs}>
              <button type="submit">Unisci tutte</button>
            </form>
          )}
        </div>
        <p className="muted">
          Unendo, l&apos;album Google resta (titolo, condivisioni, link con nome) e riceve le foto della cartella: gli
          scatti non esportati vanno in fondo, nella sezione «Altri scatti»; i CR2 e i JPEG che stanno dietro a un
          export non si vedono nella griglia ma si aprono dal link al RAW. La cartella va nel cestino e il suo vecchio
          indirizzo porta all&apos;album. Già unite: {formatCount(Number(mergedRow?.n ?? 0))} album. «Unisci tutte»
          lavora per circa 40 secondi: se ne restano, premi di nuovo.
        </p>
        {confirmed.length === 0 ? (
          <p className="muted">Nessuna.</p>
        ) : (
          <details>
            <summary>Mostra</summary>
            <div className="match-list">
              {confirmed.map((g) => (
                <GroupRow key={g.g_pid} g={g} urls={urls} merge />
              ))}
            </div>
          </details>
        )}
      </section>

      {rejected.length > 0 && (
        <section className="card">
          <h2>Scartate ({formatCount(rejected.length)} album)</h2>
          <details>
            <summary>Mostra</summary>
            <div className="match-list">
              {rejected.map((g) => (
                <GroupRow key={g.g_pid} g={g} urls={urls} />
              ))}
            </div>
          </details>
        </section>
      )}

      <section className="card">
        <h2>Album Google senza cartella ({formatCount(unpaired.length)})</h2>
        <p className="muted">
          Foto del telefono o di altre fotocamere, raccolte di più eventi (nessuna cartella arriva al{" "}
          {Math.round(PAIR_MIN_SHARE * 100)}%), oppure album di cui hai scartato le cartelle. Restano come sono.
        </p>
        {unpaired.length > 0 && (
          <details>
            <summary>Mostra</summary>
            <ul>
              {unpaired.map((a) => (
                <li key={a.public_id}>
                  <Link prefetch={false} href={`/album/${a.public_id}`}>
                    {a.title}
                  </Link>{" "}
                  <span className="muted">({formatCount(Number(a.n))} foto)</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </>
  );
}
