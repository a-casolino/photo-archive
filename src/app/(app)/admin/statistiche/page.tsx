import Link from "next/link";
import {
  BUCKET_REGION,
  ESTIMATED_SIZE,
  monthlyCost,
  PRICES_CHECKED,
  projectStorage,
  STORAGE_CLASS_LABEL,
  sumSeries,
  toEur,
  totalUsd,
  USD_TO_EUR,
  type StorageClass,
} from "@/lib/cost-rules";
import { env } from "@/lib/env";
import { formatBytes, formatCount } from "@/lib/format";
import { bucketMetrics, type DailyBytes } from "@/lib/gcs-metrics";
import { requireOwner } from "@/lib/session";
import { archiveStats } from "@/lib/stats";
import "./stats.css";

/** Dimensione dell'archivio completo per la proiezione (stima di Antonio: ~1 TB di CR2). */
const FULL_ARCHIVE_BYTES = 1e12;

const KIND_LABEL = { raw: "CR2", phone: "Foto del telefono", edit: "Export modificati" } as const;

const eur = (usd: number) =>
  toEur(usd).toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: usd > 0 && toEur(usd) < 0.1 ? 3 : 2,
  });

const monthFmt = new Intl.DateTimeFormat("it-IT", { month: "short", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "UTC" });

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(value > 0 ? 1 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <span className="stats-bar" aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

function DailyChart({ points, label }: { points: DailyBytes[]; label: string }) {
  const max = Math.max(0, ...points.map((p) => p.bytes));
  if (!points.length) return <p className="muted">Nessun dato negli ultimi 30 giorni.</p>;
  return (
    <div className="stats-daily" role="img" aria-label={label}>
      {points.map((p) => (
        <span
          key={p.date}
          title={`${dayFmt.format(new Date(p.date))}: ${formatBytes(p.bytes)}`}
          style={{ height: `${max > 0 ? Math.max(p.bytes > 0 ? 2 : 0, (p.bytes / max) * 100) : 0}%` }}
        />
      ))}
    </div>
  );
}

export default async function StatsPage({ searchParams }: PageProps<"/admin/statistiche">) {
  await requireOwner();
  const sp = await searchParams;
  const [stats, metricsResult] = await Promise.all([archiveStats(), bucketMetrics(sp.aggiorna === "1")]);
  const metrics = metricsResult.ok ? metricsResult.metrics : null;

  // Spazio nel bucket per classe: misurato da Google se possibile, altrimenti
  // stimato dal database (originali esatti, anteprime con peso medio).
  const estimatedStandardExtra =
    stats.bucket.previews * ESTIMATED_SIZE.preview +
    stats.bucket.thumbs * ESTIMATED_SIZE.thumb +
    stats.bucket.faces * ESTIMATED_SIZE.face;
  const storedBytes: Partial<Record<StorageClass, number>> = {};
  if (metrics) {
    for (const s of metrics.storage) storedBytes[s.cls] = (storedBytes[s.cls] ?? 0) + s.bytes;
  } else {
    for (const o of stats.bucket.originals) storedBytes[o.cls] = (storedBytes[o.cls] ?? 0) + o.bytes;
    storedBytes.STANDARD = (storedBytes.STANDARD ?? 0) + estimatedStandardExtra;
  }

  const egress30 = metrics ? sumSeries(metrics.egressDaily) : null;
  const ingress30 = metrics ? sumSeries(metrics.ingressDaily) : null;
  const lines = monthlyCost({
    storedBytes,
    egressBytes: egress30,
    opsA: metrics?.opsA ?? null,
    opsB: metrics?.opsB ?? null,
    archiveWrites: stats.last30.archiveWrites,
    archiveReadBytes: stats.last30.archiveReadBytes,
  });
  const total = totalUsd(lines);

  const originalBytes = stats.bucket.originals.reduce((s, o) => s + o.bytes, 0);
  const originalCount = stats.bucket.originals.reduce((s, o) => s + o.n, 0);
  const projection = projectStorage(FULL_ARCHIVE_BYTES, {
    originalBytes,
    originalCount,
    standardBytes: storedBytes.STANDARD ?? 0,
  });
  const projectionLines = monthlyCost({
    storedBytes: { ARCHIVE: projection.archiveBytes, STANDARD: projection.standardBytes },
    egressBytes: egress30,
    opsA: null,
    opsB: null,
    archiveWrites: 0,
    archiveReadBytes: stats.last30.archiveReadBytes,
  });
  const projectionTotal = totalUsd(projectionLines);
  const uploadAllCost = toEur((projection.photos / 1000) * 0.05); // scritture in Archive, una volta sola

  const photosTotal = stats.kinds.reduce((s, k) => s + k.n, 0);
  const bytesTotal = stats.kinds.reduce((s, k) => s + k.bytes, 0);
  const maxYear = Math.max(0, ...stats.byYear.map((y) => y.bytes));
  const maxMonth = Math.max(0, ...stats.byMonth.map((m) => m.bytes));
  const bucketTotal = Object.values(storedBytes).reduce((s, v) => s + (v ?? 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Statistiche</h1>
          <p className="muted">
            Foto, spazio, traffico verso Google Cloud e una stima del costo mensile. Visibile solo a te.
          </p>
        </div>
      </div>

      <section className="stats-grid">
        <div className="card stats-cost">
          <div className="stat-label">Costo stimato di Google Cloud</div>
          <div className="stats-big">{eur(total)} / mese</div>
          <table className="stats-table">
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td>{l.label}</td>
                  <td className="num">{l.known ? eur(l.usd) : <span className="muted">non misurato</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted stats-note">
            Listino {BUCKET_REGION} del {PRICES_CHECKED}, in dollari convertiti a {USD_TO_EUR.toLocaleString("it-IT")} €.
            Traffico e operazioni sono quelli degli ultimi 30 giorni. Esclusi IVA e crediti gratuiti.
          </p>
        </div>

        <div className="card stats-cost">
          <div className="stat-label">Con tutto l&apos;archivio (~{formatBytes(FULL_ARCHIVE_BYTES)} di CR2)</div>
          <div className="stats-big">{eur(projectionTotal)} / mese</div>
          <table className="stats-table">
            <tbody>
              <tr>
                <td>Foto stimate</td>
                <td className="num">~{formatCount(projection.photos)}</td>
              </tr>
              <tr>
                <td>CR2 in Archive</td>
                <td className="num">{formatBytes(projection.archiveBytes)}</td>
              </tr>
              <tr>
                <td>Anteprime in Standard</td>
                <td className="num">~{formatBytes(projection.standardBytes)}</td>
              </tr>
              <tr>
                <td>Caricamento (una volta sola)</td>
                <td className="num">
                  ~{uploadAllCost.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="muted stats-note">
            Peso medio dei CR2 e proporzione delle anteprime presi dall&apos;archivio di oggi, traffico uguale a quello
            attuale. I CR2 in Archive si pagano almeno 365 giorni anche se eliminati prima.
          </p>
        </div>
      </section>

      <h2>Archivio</h2>
      <div className="import-stats">
        <div className="card">
          <div className="stat-value">{formatCount(photosTotal)}</div>
          <div className="stat-label">Foto in totale · {formatBytes(bytesTotal)}</div>
        </div>
        {(["raw", "phone", "edit"] as const).map((k) => {
          const s = stats.kinds.find((x) => x.kind === k);
          return (
            <div className="card" key={k}>
              <div className="stat-value">{formatCount(s?.n ?? 0)}</div>
              <div className="stat-label">
                {KIND_LABEL[k]} · {formatBytes(s?.bytes ?? 0)}
              </div>
            </div>
          );
        })}
        <Link prefetch={false} className="card" href="/album">
          <div className="stat-value">{formatCount(stats.counts.albums)}</div>
          <div className="stat-label">Album</div>
        </Link>
        <Link prefetch={false} className="card" href="/persone">
          <div className="stat-value">{formatCount(stats.counts.people)}</div>
          <div className="stat-label">Persone · {formatCount(stats.counts.faces)} volti</div>
        </Link>
        <Link prefetch={false} className="card" href="/admin/condivisioni">
          <div className="stat-value">{formatCount(stats.counts.activeShares)}</div>
          <div className="stat-label">
            Condivisioni attive · {formatCount(stats.counts.users)} utenti · {formatCount(stats.counts.namedLinks)} link
            con nome
          </div>
        </Link>
        <Link prefetch={false} className="card" href="/admin/cestino">
          <div className="stat-value">{formatCount(stats.trash.n)}</div>
          <div className="stat-label">Nel cestino · {formatBytes(stats.trash.bytes)}</div>
        </Link>
      </div>
      {stats.pendingOriginals.n > 0 && (
        <p className="muted">
          Originali ancora da caricare: {formatCount(stats.pendingOriginals.n)} (
          {formatBytes(stats.pendingOriginals.bytes)}), non ancora nel bucket.
        </p>
      )}

      <h2>Google Cloud Storage</h2>
      {!metrics && (
        <p className="msg msg-error" role="status">
          {metricsResult.ok ? null : metricsResult.message}{" "}
          {!metricsResult.ok && metricsResult.reason === "permission" && (
            <>
              Nella console Google Cloud, progetto dell&apos;archivio → IAM, dai all&apos;account di servizio
              dell&apos;app il ruolo <strong>Monitoring Viewer</strong>. Intanto lo spazio è stimato dal database e il
              traffico non è misurato.
            </>
          )}
        </p>
      )}
      <section className="stats-grid">
        <div className="card">
          <h3>Spazio nel bucket {env().GCS_BUCKET ? <code>{env().GCS_BUCKET}</code> : null}</h3>
          <table className="stats-table">
            <thead>
              <tr>
                <th>Classe</th>
                <th className="num">File</th>
                <th className="num">Spazio</th>
              </tr>
            </thead>
            <tbody>
              {metrics
                ? metrics.storage
                    .sort((a, b) => b.bytes - a.bytes)
                    .map((s) => (
                      <tr key={s.cls}>
                        <td>{STORAGE_CLASS_LABEL[s.cls]}</td>
                        <td className="num">{formatCount(s.objects)}</td>
                        <td className="num">{formatBytes(s.bytes)}</td>
                      </tr>
                    ))
                : (["ARCHIVE", "STANDARD"] as const).map((cls) => {
                    const originals = stats.bucket.originals.filter((o) => o.cls === cls);
                    const files =
                      originals.reduce((s, o) => s + o.n, 0) +
                      (cls === "STANDARD" ? stats.bucket.previews + stats.bucket.thumbs + stats.bucket.faces : 0);
                    return (
                      <tr key={cls}>
                        <td>{STORAGE_CLASS_LABEL[cls]}</td>
                        <td className="num">{formatCount(files)}</td>
                        <td className="num">~{formatBytes(storedBytes[cls] ?? 0)}</td>
                      </tr>
                    );
                  })}
              <tr className="stats-total">
                <td>Totale</td>
                <td />
                <td className="num">{formatBytes(bucketTotal)}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted stats-note">
            {metrics
              ? `Misurato da Google${metrics.measuredAt ? ` il ${dayFmt.format(metrics.measuredAt)}` : ""} (si aggiorna una volta al giorno), file nel cestino dell'app compresi.`
              : "Stima dal database: originali esatti, anteprime e miniature con peso medio."}
          </p>
        </div>

        <div className="card">
          <h3>Traffico, ultimi 30 giorni</h3>
          {metrics ? (
            <>
              <p>
                <strong>{formatBytes(egress30)}</strong> in uscita verso internet (anteprime viste, download, lettura
                dei volti dalla VPS)
              </p>
              <DailyChart points={metrics.egressDaily} label="Traffico in uscita giorno per giorno" />
              <p>
                <strong>{formatBytes(ingress30)}</strong> in entrata (caricamenti, gratuito)
              </p>
              <DailyChart points={metrics.ingressDaily} label="Traffico in entrata giorno per giorno" />
              <p className="muted stats-note">
                Richieste: {formatCount(metrics.opsA)} di classe A (scritture, elenchi), {formatCount(metrics.opsB)} di
                classe B (letture).{" "}
                <Link prefetch={false} href="/admin/statistiche?aggiorna=1">
                  Aggiorna ora
                </Link>
              </p>
            </>
          ) : (
            <p className="muted">Serve l&apos;accesso alle metriche di Google Cloud.</p>
          )}
          <p className="muted stats-note">
            Dalle condivisioni: {formatCount(stats.last30.views)} visite, {formatCount(stats.last30.previewDownloads)}{" "}
            download JPEG, {formatCount(stats.last30.originalDownloads)} download di originali.
          </p>
        </div>
      </section>

      <section className="stats-grid">
        <div className="card">
          <h3>Per anno di scatto</h3>
          <table className="stats-table">
            <tbody>
              {stats.byYear.map((y) => (
                <tr key={y.year ?? "nd"}>
                  <td>{y.year ?? "Senza data"}</td>
                  <td className="num">{formatCount(y.n)}</td>
                  <td className="stats-bar-cell">
                    <Bar value={y.bytes} max={maxYear} />
                  </td>
                  <td className="num">{formatBytes(y.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Caricate negli ultimi 12 mesi</h3>
          {stats.byMonth.length === 0 && <p className="muted">Niente di caricato.</p>}
          <table className="stats-table">
            <tbody>
              {stats.byMonth.map((m) => (
                <tr key={m.month}>
                  <td>{monthFmt.format(new Date(`${m.month}-01T00:00:00Z`))}</td>
                  <td className="num">{formatCount(m.n)}</td>
                  <td className="stats-bar-cell">
                    <Bar value={m.bytes} max={maxMonth} />
                  </td>
                  <td className="num">{formatBytes(m.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
