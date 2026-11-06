import { estimateRemainingMs, formatBytes, formatCount, formatDuration } from "@/lib/format";
import { isStale, type ImportRow } from "@/lib/imports";

export const SOURCE_LABEL = { cr2_disk: "Disco CR2", google_takeout: "Google Takeout" } as const;

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

/** Barra di avanzamento con contatori e tempo stimato. */
export function ImportProgress({ imp }: { imp: ImportRow }) {
  const total = Number(imp.bytes_total ?? 0);
  const done = Number(imp.bytes_done);
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : imp.status === "finished" ? 100 : 0;
  const end = imp.finished_at ?? new Date();
  const elapsed = end.getTime() - imp.started_at.getTime();
  const remaining = imp.status === "running" ? estimateRemainingMs(done, total, elapsed) : null;

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
    </div>
  );
}
