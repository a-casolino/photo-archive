"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatBytes, formatCount, formatDuration, formatRate } from "@/lib/format";
import { UploadEngine, type FileState, type Snapshot, type UploadItem } from "@/lib/upload/engine";
import { entriesFromDrop, filesFromEntries, filesFromInput } from "@/lib/upload/files";
import { albumSummary } from "@/lib/upload/plan";

/*
 * Interfaccia della pagina "Carica dal browser": scelta dei file, riepilogo
 * prima di partire, coda con avanzamento, pausa e "Riprova gli errori".
 * Il lavoro lo fa UploadEngine (src/lib/upload/engine.ts).
 */

const STATE_LABEL: Record<FileState, string> = {
  waiting: "In attesa",
  hash: "Impronta",
  check: "Controllo",
  previews: "Lettura e anteprime",
  upload_previews: "Invio anteprime",
  commit: "Registrazione",
  original_queued: "Originale in coda",
  upload_original: "Invio originale",
  done: "Fatto",
  existing: "Già nell'archivio",
  error: "Errore",
};

const ACTIVE: FileState[] = ["hash", "check", "previews", "upload_previews", "commit", "upload_original"];
/** Stati in cui la foto è già nell'archivio con le anteprime. */
const HAS_PREVIEW: FileState[] = ["original_queued", "upload_original", "done", "existing"];

/** Peso medio delle due anteprime (2048 + 400 px), per la stima. */
const PREVIEW_BYTES = 600_000;

const TYPE_LABEL: Record<string, string> = {
  "image/x-canon-cr2": "CR2",
  "image/x-adobe-dng": "DNG",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/heic": "HEIC",
  "image/heif": "HEIC",
  "image/webp": "WebP",
  "image/gif": "GIF",
};

function count(items: UploadItem[], ...states: FileState[]) {
  return items.filter((i) => states.includes(i.state)).length;
}

export function Uploader({
  wasmUrl,
  recentBps,
  testStorage,
  today,
}: {
  wasmUrl: string;
  recentBps: number | null;
  testStorage: boolean;
  today: string;
}) {
  const engine = useRef<UploadEngine | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const e = new UploadEngine({ wasmUrl, defaultLooseTitle: `Caricate il ${today}`, onChange: setSnap });
    engine.current = e;
    return () => {
      e.dispose();
      engine.current = null;
    };
  }, [wasmUrl, today]);

  const phase = snap?.phase ?? "empty";
  const working = phase === "running";
  const items = snap?.items ?? [];

  // Mentre carica: lo schermo resta acceso e chiudere la pagina chiede conferma.
  useEffect(() => {
    if (!working) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        if (document.visibilityState === "visible" && "wakeLock" in navigator) lock = await navigator.wakeLock.request("screen");
      } catch {
        // non supportato o negato: pazienza
      }
    };
    void acquire();
    const onVisible = () => void acquire();
    const onLeave = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = "";
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("beforeunload", onLeave);
      void lock?.release().catch(() => {});
    };
  }, [working]);

  const canPick = phase === "empty" || phase === "ready" || phase === "reading";

  async function onDrop(ev: React.DragEvent) {
    ev.preventDefault();
    setDragging(false);
    if (!canPick || !engine.current) return;
    const dropped = entriesFromDrop(ev.dataTransfer);
    engine.current.setReading(0);
    const picked = await filesFromEntries(dropped, (n) => engine.current?.setReading(n));
    engine.current?.add(picked);
  }

  function onPick(list: FileList | null) {
    engine.current?.add(filesFromInput(list));
    if (fileInput.current) fileInput.current.value = "";
    if (folderInput.current) folderInput.current.value = "";
  }

  return (
    <>
      {snap?.fatal && <p className="msg-error card">{snap.fatal}</p>}

      {canPick && (
        <section
          className={`card upload-drop${dragging ? " dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p>
            <strong>Trascina qui foto o cartelle intere.</strong> Ogni cartella diventa un album e le sottocartelle
            i suoi sotto-album (fino a 3 livelli). CR2, JPG, PNG e HEIC; i video si saltano.
          </p>
          <div className="actions">
            <Button type="button" onClick={() => fileInput.current?.click()}>
              Scegli foto
            </Button>
            <Button type="button" variant="secondary" className="upload-folder-button" onClick={() => folderInput.current?.click()}>
              Scegli cartella
            </Button>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept="image/*,.cr2,.CR2,.heic,.HEIC"
            onChange={(e) => onPick(e.target.files)}
          />
          <input
            ref={folderInput}
            type="file"
            hidden
            // @ts-expect-error: attributo non standard, supportato da tutti i browser desktop
            webkitdirectory=""
            onChange={(e) => onPick(e.target.files)}
          />
          {phase === "reading" && <p className="muted">Lettura delle cartelle… {formatCount(snap?.readingCount)} file</p>}
          {testStorage && (
            <p className="muted">Archivio di prova (cartella sul server): i file passano dall&apos;app invece che da Google Cloud.</p>
          )}
        </section>
      )}

      {snap && items.length > 0 && (phase === "ready" || phase === "reading") && (
        <Summary snap={snap} recentBps={recentBps} engineRef={engine} />
      )}

      {snap && (phase === "running" || phase === "paused" || phase === "finished") && (
        <Progress snap={snap} engineRef={engine} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Riepilogo prima di partire
// ---------------------------------------------------------------------

function Summary({
  snap,
  recentBps,
  engineRef,
}: {
  snap: Snapshot;
  recentBps: number | null;
  engineRef: React.RefObject<UploadEngine | null>;
}) {
  const engine = () => engineRef.current;
  const { items } = snap;
  const albums = albumSummary(items);
  const byType = new Map<string, { n: number; bytes: number }>();
  for (const it of items) {
    const t = TYPE_LABEL[it.mime] ?? it.mime;
    const s = byType.get(t) ?? { n: 0, bytes: 0 };
    s.n++;
    s.bytes += it.size;
    byType.set(t, s);
  }
  const totalBytes = items.reduce((s, i) => s + i.size, 0);
  const loose = items.filter((i) => i.loose).length;
  const existing = items.filter((i) => i.known === "existing").length;
  const pending = items.filter((i) => i.known === "pending_original");
  const fresh = items.filter((i) => i.known !== "existing");
  const originalBytes = fresh.reduce((s, i) => s + i.size, 0);
  const previewBytes = items.filter((i) => i.known === "new" || i.known === null).length * PREVIEW_BYTES;
  const skipped = snap.skipped.video + snap.skipped.other;

  return (
    <section className="card">
      <h2>Riepilogo</h2>
      <div className="import-stats">
        <div className="card">
          <div className="stat-value">{formatCount(items.length)}</div>
          <div className="stat-label">foto, {formatBytes(totalBytes)}</div>
        </div>
        {[...byType.entries()].map(([t, s]) => (
          <div className="card" key={t}>
            <div className="stat-value">{formatCount(s.n)}</div>
            <div className="stat-label">
              {t}, {formatBytes(s.bytes)}
            </div>
          </div>
        ))}
      </div>

      <p>
        {snap.lookedUp ? (
          <>
            <strong>Già nell&apos;archivio: {formatCount(existing)}</strong> (si saltano senza caricarle)
            {pending.length > 0 && <> · originali da completare: {formatCount(pending.length)}</>} · da caricare:{" "}
            {formatCount(fresh.length - pending.length)}
          </>
        ) : (
          <span className="muted">
            Controllo di cosa c&apos;è già nell&apos;archivio… {formatCount(snap.hashed)} di {formatCount(items.length)}
          </span>
        )}
      </p>
      {!snap.lookedUp && (
        <div className="progress" aria-hidden>
          <span style={{ width: `${(snap.hashed / Math.max(1, items.length)) * 100}%` }} />
        </div>
      )}

      {albums.length > 0 && (
        <>
          <h3>Album</h3>
          <ul className="upload-albums">
            {albums.slice(0, 60).map((a) => (
              <li key={a.key} style={{ paddingLeft: `${(a.depth - 1) * 1.25}rem` }}>
                {a.title}
                {a.files > 0 && (
                  <span className="muted">
                    {" "}
                    · {formatCount(a.files)} foto, {formatBytes(a.bytes)}
                  </span>
                )}
              </li>
            ))}
            {albums.length > 60 && <li className="muted">e altri {albums.length - 60} album</li>}
          </ul>
        </>
      )}

      {loose > 0 && (
        <label className="upload-loose">
          Album per {loose === 1 ? "la foto scelta da sola" : `le ${formatCount(loose)} foto scelte da sole`}
          <input
            type="text"
            maxLength={255}
            value={snap.looseTitle}
            onChange={(e) => engine()?.setLooseTitle(e.target.value)}
            placeholder="Nessun album"
          />
          <span className="muted">Lascia vuoto per non metterle in un album (le trovi comunque in Foto).</span>
        </label>
      )}

      {skipped > 0 && (
        <p className="muted">
          Ignorati: {snap.skipped.video > 0 && `${formatCount(snap.skipped.video)} video`}
          {snap.skipped.video > 0 && snap.skipped.other > 0 && ", "}
          {snap.skipped.other > 0 && `${formatCount(snap.skipped.other)} altri file (.xmp, .json…)`}
        </p>
      )}

      <p>
        {recentBps ? (
          <>
            Alla tua velocità recente ({formatRate(recentBps)}): anteprime in circa{" "}
            <strong>{formatDuration((previewBytes / recentBps) * 1000)}</strong>, originali ({formatBytes(originalBytes)}) in
            circa <strong>{formatDuration(((previewBytes + originalBytes) / recentBps) * 1000)}</strong>.
          </>
        ) : (
          <>Da caricare: circa {formatBytes(previewBytes)} di anteprime e {formatBytes(originalBytes)} di originali.</>
        )}{" "}
        <span className="muted">
          Prima arrivano le anteprime di tutte le foto, così gli album sono subito completi; poi gli originali. Tieni la
          pagina aperta: se la chiudi, scegli di nuovo le stesse foto e si riparte da dove eri arrivato.
        </span>
      </p>

      <div className="actions">
        <Button type="button" onClick={() => void engine()?.start()} disabled={snap.phase === "reading"}>
          Inizia il caricamento
        </Button>
        <Button type="button" variant="secondary" onClick={() => engine()?.clear()}>
          Svuota
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// Avanzamento
// ---------------------------------------------------------------------

function Progress({ snap, engineRef }: { snap: Snapshot; engineRef: React.RefObject<UploadEngine | null> }) {
  const engine = () => engineRef.current;
  const { items, phase } = snap;
  const [list, setList] = useState<"active" | "errors" | "all">("active");
  const withPreview = count(items, ...HAS_PREVIEW);
  const errors = items.filter((i) => i.state === "error");
  const originals = items.filter((i) => i.state !== "existing");
  const originalBytes = originals.reduce((s, i) => s + i.size, 0);
  const receivedBytes = originals.reduce((s, i) => s + (i.state === "done" ? i.size : i.received), 0);
  const originalsDone = count(items, "done");
  const remaining = originalBytes - receivedBytes;
  const eta = snap.uploadBps > 1000 && remaining > 0 ? (remaining / snap.uploadBps) * 1000 : null;
  const shown =
    list === "active"
      ? items.filter((i) => ACTIVE.includes(i.state))
      : list === "errors"
        ? errors
        : items.slice(0, 500);

  return (
    <section className="card">
      <div className="import-head">
        <h2>
          {phase === "running" ? "Caricamento in corso" : phase === "paused" ? "In pausa" : "Caricamento finito"}
        </h2>
        {snap.importId && (
          <Link prefetch={false} href={`/admin/import/${snap.importId}`} className="muted">
            Dettagli dell&apos;import
          </Link>
        )}
      </div>

      <p>
        <strong>Foto nell&apos;archivio:</strong> {formatCount(withPreview)} di {formatCount(items.length)}
        {count(items, "existing") > 0 && <span className="muted"> (di cui {formatCount(count(items, "existing"))} c&apos;erano già)</span>}
      </p>
      <div className="progress" aria-hidden>
        <span style={{ width: `${(withPreview / Math.max(1, items.length)) * 100}%` }} />
      </div>

      <p>
        <strong>Originali:</strong> {formatCount(originalsDone)} di {formatCount(originals.length)} ·{" "}
        {formatBytes(receivedBytes)} di {formatBytes(originalBytes)}
        {phase === "running" && (
          <span className="muted">
            {" "}
            · {formatRate(snap.uploadBps)}
            {eta !== null && <> · circa {formatDuration(eta)} alla fine</>}
          </span>
        )}
      </p>
      <div className="progress" aria-hidden>
        <span style={{ width: `${(receivedBytes / Math.max(1, originalBytes)) * 100}%` }} />
      </div>

      {phase === "running" && (
        <p className="muted">
          Tieni la pagina aperta (lo schermo resta acceso). Gli originali arrivano a pezzi: se la connessione cade
          riprendono da soli.
        </p>
      )}

      {phase === "finished" && snap.result && (
        <div className="upload-result">
          <p>
            <strong>
              Fatto: {formatCount(count(items, "done"))} foto nuove, {formatCount(count(items, "existing"))} già
              presenti{errors.length > 0 && `, ${formatCount(errors.length)} con errori`}.
            </strong>{" "}
            <Link prefetch={false} href="/album">
              Vai agli album
            </Link>
          </p>
          {snap.result.matched > 0 && (
            <p>
              Export collegati in automatico al loro CR2: {formatCount(snap.result.matched)} (
              <Link prefetch={false} href="/admin/import/collegamenti">
                rivedi
              </Link>
              ).
            </p>
          )}
          {snap.result.duplicates > 0 && (
            <p>
              Probabili doppioni da rivedere nell&apos;archivio: {formatCount(snap.result.duplicates)} (
              <Link prefetch={false} href="/admin/import/doppioni">
                apri
              </Link>
              ).
            </p>
          )}
        </div>
      )}

      <div className="actions">
        {phase === "running" && (
          <Button type="button" variant="secondary" onClick={() => engine()?.pause()}>
            Pausa
          </Button>
        )}
        {phase === "paused" && (
          <Button type="button" onClick={() => engine()?.resume()}>
            Riprendi
          </Button>
        )}
        {phase !== "running" && errors.length > 0 && (
          <Button type="button" onClick={() => engine()?.retryErrors()}>
            Riprova gli errori ({formatCount(errors.length)})
          </Button>
        )}
        {phase === "finished" && (
          <Button type="button" variant="secondary" onClick={() => engine()?.clear()}>
            Carica altre foto
          </Button>
        )}
      </div>

      <div className="upload-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={list === "active"} onClick={() => setList("active")}>
          In corso ({formatCount(count(items, ...ACTIVE))})
        </button>
        <button type="button" role="tab" aria-selected={list === "errors"} onClick={() => setList("errors")}>
          Errori ({formatCount(errors.length)})
        </button>
        <button type="button" role="tab" aria-selected={list === "all"} onClick={() => setList("all")}>
          Tutti ({formatCount(items.length)})
        </button>
      </div>
      <ul className="upload-files">
        {shown.length === 0 && <li className="muted">Nessun file.</li>}
        {shown.map((i) => (
          <li key={i.id}>
            <span className="current-file" title={i.path}>
              {i.path}
            </span>
            <span className={i.state === "error" ? "msg-error" : "muted"}>
              {STATE_LABEL[i.state]}
              {i.state === "upload_original" && ` ${Math.floor((i.received / Math.max(1, i.size)) * 100)}%`}
            </span>
            {i.error && <span className="msg-error upload-error">{i.error}</span>}
          </li>
        ))}
        {list === "all" && items.length > 500 && <li className="muted">Mostrati i primi 500.</li>}
      </ul>
    </section>
  );
}
