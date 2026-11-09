import { DRIVE_DEVICE_NAME } from "@/lib/drive-rules";
import { estimateRemainingMs, formatBytes, formatCount, formatDuration, formatRate } from "@/lib/format";
import { STEP_LABEL, type ImportActivity } from "@/lib/import-shared";
import { isStale, type ImportRow } from "@/lib/imports";

const SOURCE_LABEL = { cr2_disk: "Disco", google_takeout: "Google Takeout" } as const;

/** Fonte di un import; quelli fatti dalla VPS leggendo Google Drive si riconoscono dalla chiave usata. */
export function sourceLabel(source: ImportRow["source"], deviceName: string | null | undefined): string {
  if (deviceName === DRIVE_DEVICE_NAME) return source === "google_takeout" ? "Takeout da Drive" : "Google Drive";
  return SOURCE_LABEL[source];
}

const STATUS_LABEL: Record<ImportRow["status"], string> = {
  running: "In corso",
  finished: "Completato",
  interrupted: "Interrotto",
  failed: "Fallito",
};

export function StatusBadge({ imp }: { imp: ImportRow }) {
  if (isStale(imp)) return <span className="badge badge-stale">Nessun segnale</span>;
  return <span className={`badge badge-${imp.status}`}>{STATUS_LABEL[imp.status]}</span>;
}

/** Barra di avanzamento con contatori, velocità, tempo stimato e file in lavorazione. */
export function ImportProgress({ imp }: { imp: ImportRow }) {
  const total = Number(imp.bytes_total ?? 0);
  const done = Number(imp.bytes_done);
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : imp.status === "finished" ? 100 : 0;
  const end = imp.finished_at ?? new Date();
  const elapsed = end.getTime() - imp.started_at.getTime();
  const live = imp.status === "running" && !isStale(imp);
  const activity = live ? imp.activity_json : null;
  const remaining = live ? estimateRemainingMs(done, total, elapsed, activity?.doneBps) : null;
  const avgUpload = elapsed > 0 ? (Number(imp.bytes_uploaded) * 1000) / elapsed : null;

  return (
    <div>
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="counters">
        <span>
          <strong>{pct.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%</strong> ({formatBytes(done)} di{" "}
          {formatBytes(imp.bytes_total)})
        </span>
        <span>
          File: {formatCount(imp.files_seen)} di {formatCount(imp.files_total)}
        </span>
        <span>Importati: {formatCount(imp.files_imported)}</span>
        <span>Già presenti: {formatCount(imp.files_skipped)}</span>
        <span className={imp.files_failed > 0 ? "msg-error" : undefined}>Errori: {formatCount(imp.files_failed)}</span>
        <span>Caricati: {formatBytes(imp.bytes_uploaded)}</span>
        <span>
          {imp.status === "running" ? "Da" : "Durata"}: {formatDuration(elapsed)}
        </span>
        {remaining !== null && <span>Fine stimata tra {formatDuration(remaining)}</span>}
      </div>
      {activity ? (
        <Activity activity={activity} />
      ) : (
        <>
          {live && imp.current_file && <p className="current-file">{imp.current_file}</p>}
          {!live && Number(imp.bytes_uploaded) > 0 && (
            <div className="counters">
              <span>Velocità media di upload: {formatRate(avgUpload)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Cosa sta facendo il programma adesso: velocità e una riga per ogni file in lavorazione. */
function Activity({ activity }: { activity: ImportActivity }) {
  return (
    <div className="activity">
      <div className="counters">
        <span>
          Upload adesso: <strong>{formatRate(activity.uploadBps)}</strong>
        </span>
        <span>Lavorazione: {formatBytes(activity.doneBps)}/s di file</span>
        <span>
          File in parallelo: {activity.workers.length} di {activity.parallel}
        </span>
      </div>
      <ul className="workers">
        {activity.workers.map((w, i) => {
          const pct = w.sent !== undefined && w.size > 0 ? Math.min(100, (w.sent / w.size) * 100) : null;
          return (
            <li key={i}>
              <span className="current-file">{w.file}</span>
              <span className="worker-step">
                {STEP_LABEL[w.step]}
                {pct !== null ? ` · ${Math.round(pct)}% di ${formatBytes(w.size)}` : ` · ${formatBytes(w.size)}`}
              </span>
              {pct !== null && (
                <div className="progress progress-small" aria-hidden>
                  <span style={{ width: `${pct}%` }} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
