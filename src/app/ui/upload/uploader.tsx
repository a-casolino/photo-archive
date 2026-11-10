"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatBytes, formatCount, formatDuration, formatRate } from "@/lib/format";
import { UploadEngine, type FileState, type Phase, type Snapshot, type UploadItem } from "@/lib/upload/engine";
import {
  allowRead,
  canKeepHandles,
  entriesFromDrop,
  filesFromEntries,
  filesFromHandles,
  filesFromInput,
  handlesFromDrop,
  pickFiles,
  pickFolder,
} from "@/lib/upload/files";
import { albumSummary, type IntoAlbum, type PickedFile } from "@/lib/upload/plan";
import { forgetUpload, loadUpload, saveUpload, type SavedUpload } from "@/lib/upload/saved";
import "./upload.css";

/*
 * Interfaccia del caricamento dal browser (pagina "Carica dal browser" e
 * pagina dell'album): scelta dei file, riepilogo prima di partire, coda con
 * avanzamento, pausa, "Riprova gli errori" e "Riprendi" dopo una chiusura.
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

/** Quello che si trascina: va letto subito, dentro l'evento drop. */
export type Dropped = { entries: ReturnType<typeof entriesFromDrop>; handles: ReturnType<typeof handlesFromDrop> };

export function readDrop(dt: DataTransfer): Dropped {
  return { entries: entriesFromDrop(dt), handles: handlesFromDrop(dt) };
}

const dateFmt = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export function Uploader({
  wasmUrl,
  recentBps,
  testStorage,
  today,
  scope,
  into = null,
  dropped = null,
  onFinished,
  onPhaseChange,
}: {
  wasmUrl: string;
  recentBps: number | null;
  testStorage: boolean;
  today: string;
  /** Dove si ricorda un caricamento lasciato a metà: "carica" o l'album aperto. */
  scope: string;
  /** Caricamento dentro un album aperto. */
  into?: IntoAlbum | null;
  /** File trascinati sulla pagina dell'album prima di aprire il pannello. */
  dropped?: Dropped | null;
  onFinished?: () => void;
  onPhaseChange?: (phase: Phase) => void;
}) {
  const engine = useRef<UploadEngine | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saved, setSaved] = useState<SavedUpload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  /** Riferimenti di Chrome/Edge ai file scelti, per riprendere senza riscegliere. */
  const handles = useRef<FileSystemHandle[]>([]);
  /** false se qualcosa è stato scelto senza riferimento (pulsanti classici, altri browser). */
  const allHandles = useRef(true);
  const savedFor = useRef<string | null>(null);
  /** Tutto scelto con riferimenti: chiudendo la pagina si potrà riprendere. */
  const [resumable, setResumable] = useState(false);
  const intoKey = into ? `${into.publicId}:${into.levels}:${into.title}` : "";

  useEffect(() => {
    const e = new UploadEngine({
      wasmUrl,
      defaultLooseTitle: `Caricate il ${today}`,
      onChange: setSnap,
      into: intoKey ? into : null,
    });
    engine.current = e;
    return () => {
      e.dispose();
      engine.current = null;
    };
    // `into` cambia identità a ogni render del genitore: conta solo intoKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasmUrl, today, intoKey]);

  // Un caricamento lasciato a metà in questa pagina (solo Chrome/Edge sul computer).
  useEffect(() => {
    if (!canKeepHandles()) return;
    let live = true;
    void loadUpload(scope).then((rec) => {
      if (live) setSaved(rec);
    });
    return () => {
      live = false;
    };
  }, [scope]);

  const phase = snap?.phase ?? "empty";
  const working = phase === "running";
  const items = snap?.items ?? [];
  const errorCount = items.filter((i) => i.state === "error").length;

  // Partito: si ricorda dove sono i file, finché non finisce senza errori.
  useEffect(() => {
    const importId = snap?.importId;
    if (phase !== "running" || !importId || savedFor.current === importId) return;
    if (!allHandles.current || handles.current.length === 0) return;
    savedFor.current = importId;
    void saveUpload({
      scope,
      handles: handles.current,
      importId,
      looseTitle: snap?.looseTitle ?? "",
      names: handles.current.map((h) => h.name).slice(0, 10),
      files: items.length,
      savedAt: Date.now(),
    });
  }, [phase, snap?.importId, snap?.looseTitle, items.length, scope]);

  useEffect(() => {
    onPhaseChange?.(phase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase !== "finished") return;
    if (errorCount === 0) void forgetUpload(scope);
    onFinished?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

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

  /** Nuovi file in elenco; `from` = i loro riferimenti, se il browser li ha dati. */
  function addPicked(picked: PickedFile[], from: FileSystemHandle[] | null) {
    if (from && from.length) handles.current.push(...from);
    else if (picked.length) allHandles.current = false;
    setResumable(allHandles.current && handles.current.length > 0);
    setSaved(null);
    setNotice(null);
    engine.current?.add(picked);
  }

  async function ingest(d: Dropped) {
    // Durante il caricamento non si aggiunge niente (il riquadro è nascosto).
    if (!engine.current || !canPick) return;
    engine.current.setReading(0);
    const progress = (n: number) => engine.current?.setReading(n);
    try {
      const got = d.handles.length ? await Promise.all(d.handles) : [];
      // Ogni oggetto deve avere il suo riferimento, altrimenti si usano le voci.
      const all = got.length > 0 && got.every((h) => h != null) ? (got as FileSystemHandle[]) : null;
      if (all) addPicked(await filesFromHandles(all, progress), all);
      else addPicked(await filesFromEntries(d.entries, progress), null);
    } catch (e) {
      setNotice(`Non riesco a leggere i file trascinati: ${(e as Error).message}`);
      engine.current?.add([]);
    }
  }

  // File trascinati sull'album prima che il pannello si aprisse.
  const droppedDone = useRef<Dropped | null>(null);
  useEffect(() => {
    if (!dropped || droppedDone.current === dropped || !engine.current) return;
    droppedDone.current = dropped;
    void ingest(dropped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropped, intoKey]);

  async function onDrop(ev: React.DragEvent) {
    ev.preventDefault();
    setDragging(false);
    if (!canPick || !engine.current) return;
    await ingest(readDrop(ev.dataTransfer));
  }

  function onPick(list: FileList | null) {
    addPicked(filesFromInput(list), null);
    if (fileInput.current) fileInput.current.value = "";
    if (folderInput.current) folderInput.current.value = "";
  }

  async function chooseFolder() {
    if (!canKeepHandles()) return folderInput.current?.click();
    try {
      const dir = await pickFolder();
      if (!dir) return;
      engine.current?.setReading(0);
      addPicked(await filesFromHandles([dir], (n) => engine.current?.setReading(n)), [dir]);
    } catch (e) {
      setNotice(`Cartella non leggibile: ${(e as Error).message}`);
    }
  }

  async function chooseFiles() {
    if (!canKeepHandles()) return fileInput.current?.click();
    try {
      const picked = await pickFiles();
      if (picked === null) return;
      addPicked(await filesFromHandles(picked), picked);
    } catch (e) {
      setNotice(`File non leggibili: ${(e as Error).message}`);
    }
  }

  function clearAll() {
    engine.current?.clear();
    handles.current = [];
    allHandles.current = true;
    savedFor.current = null;
    setResumable(false);
    void forgetUpload(scope);
  }

  async function resumeSaved() {
    const rec = saved;
    if (!rec || !engine.current) return;
    setNotice(null);
    try {
      // Il browser chiede di nuovo il permesso di leggere la cartella (un clic).
      if (!(await allowRead(rec.handles))) {
        setNotice("Senza il permesso di leggere la cartella non posso riprendere: scegli di nuovo le foto.");
        return;
      }
      engine.current.setReading(0);
      const picked = await filesFromHandles(rec.handles, (n) => engine.current?.setReading(n));
      handles.current = [...rec.handles];
      allHandles.current = true;
      setResumable(true);
      setSaved(null);
      engine.current.add(picked);
      engine.current.restore({ importId: rec.importId, looseTitle: rec.looseTitle });
      savedFor.current = null;
      await engine.current.start();
    } catch (e) {
      engine.current?.clear();
      const name = (e as DOMException)?.name;
      setNotice(
        name === "NotFoundError"
          ? "Non trovo più la cartella (spostata, rinominata o disco scollegato): scegli di nuovo le foto."
          : `Non riesco a riprendere: ${(e as Error).message}`,
      );
    }
  }

  async function dropSaved() {
    setSaved(null);
    await forgetUpload(scope);
  }

  const dropText = into ? (
    into.levels > 0 ? (
      <>
        <strong>Trascina qui foto o cartelle da aggiungere a «{into.title}».</strong> Le foto vanno nell&apos;album, le
        cartelle diventano suoi sotto-album. CR2, JPG, PNG e HEIC; i video si saltano.
      </>
    ) : (
      <>
        <strong>Trascina qui foto o cartelle da aggiungere a «{into.title}».</strong> L&apos;album è già al terzo livello:
        anche le foto delle cartelle vanno direttamente qui. CR2, JPG, PNG e HEIC; i video si saltano.
      </>
    )
  ) : (
    <>
      <strong>Trascina qui foto o cartelle intere.</strong> Ogni cartella diventa un album e le sottocartelle i suoi
      sotto-album (fino a 3 livelli). CR2, JPG, PNG e HEIC; i video si saltano.
    </>
  );

  return (
    <div className="uploader">
      {snap?.fatal && <p className="msg-error card">{snap.fatal}</p>}
      {notice && <p className="msg-error card">{notice}</p>}

      {saved && phase === "empty" && (
        <section className="card upload-resume">
          <p>
            <strong>Hai un caricamento lasciato a metà</strong> del {dateFmt.format(new Date(saved.savedAt))}:{" "}
            {saved.names.map((n) => `«${n}»`).join(", ")}
            {saved.names.length < saved.handles.length && ` e altri ${saved.handles.length - saved.names.length}`} (
            {formatCount(saved.files)} foto). Riprendendo si saltano quelle già arrivate e gli originali a metà
            ripartono da dove erano. Il browser ti chiederà il permesso di leggere la cartella.
          </p>
          <div className="actions">
            <Button type="button" onClick={() => void resumeSaved()}>
              Riprendi
            </Button>
            <Button type="button" variant="secondary" onClick={() => void dropSaved()}>
              Lascia perdere
            </Button>
          </div>
        </section>
      )}

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
          <p>{dropText}</p>
          <div className="actions">
            <Button type="button" onClick={() => void chooseFiles()}>
              Scegli foto
            </Button>
            <Button type="button" variant="secondary" className="upload-folder-button" onClick={() => void chooseFolder()}>
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
        <Summary
          snap={snap}
          recentBps={recentBps}
          engineRef={engine}
          into={into}
          resumable={resumable}
          onClear={clearAll}
        />
      )}

      {snap && (phase === "running" || phase === "paused" || phase === "finished") && (
        <Progress snap={snap} engineRef={engine} into={into} onClear={clearAll} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Riepilogo prima di partire
// ---------------------------------------------------------------------

function Summary({
  snap,
  recentBps,
  engineRef,
  into,
  resumable,
  onClear,
}: {
  snap: Snapshot;
  recentBps: number | null;
  engineRef: React.RefObject<UploadEngine | null>;
  into: IntoAlbum | null;
  resumable: boolean;
  onClear: () => void;
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

      {into && (
        <p>
          Le foto vanno in <strong>«{into.title}»</strong>
          {albums.length > 0 ? ", le cartelle nei sotto-album qui sotto." : "."}
        </p>
      )}
      {albums.length > 0 && (
        <>
          <h3>{into ? `Sotto-album di «${into.title}»` : "Album"}</h3>
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

      {loose > 0 && !into && (
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
          pagina aperta:{" "}
          {resumable
            ? "se la chiudi, riaprendola trovi «Riprendi» e si riparte da dove eri arrivato."
            : "se la chiudi, scegli di nuovo le stesse foto e si riparte da dove eri arrivato."}
        </span>
      </p>

      <div className="actions">
        <Button type="button" onClick={() => void engine()?.start()} disabled={snap.phase === "reading"}>
          Inizia il caricamento
        </Button>
        <Button type="button" variant="secondary" onClick={onClear}>
          Svuota
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// Avanzamento
// ---------------------------------------------------------------------

function Progress({
  snap,
  engineRef,
  into,
  onClear,
}: {
  snap: Snapshot;
  engineRef: React.RefObject<UploadEngine | null>;
  into: IntoAlbum | null;
  onClear: () => void;
}) {
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
          Tieni la pagina aperta{into ? " e non cambiare pagina" : ""} (lo schermo resta acceso). Gli originali arrivano
          a pezzi: se la connessione cade riprendono da soli.
        </p>
      )}

      {phase === "finished" && snap.result && (
        <div className="upload-result">
          <p>
            <strong>
              Fatto: {formatCount(count(items, "done"))} foto nuove, {formatCount(count(items, "existing"))} già
              presenti{errors.length > 0 && `, ${formatCount(errors.length)} con errori`}.
            </strong>{" "}
            {!into && (
              <Link prefetch={false} href="/album">
                Vai agli album
              </Link>
            )}
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
          <Button type="button" variant="secondary" onClick={onClear}>
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
