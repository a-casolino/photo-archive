import {
  PROGRAM_VERSION,
  PROGRAM_VERSION_HEADER,
  RateMeter,
  type AlbumRef,
  type CommitBody,
  type ExistingFiles,
  type ImportActivity,
  type ImportStep,
  type OriginalTarget,
  type UploadTarget,
} from "../import-shared";
import { exifJson, photoFields } from "../photo-metadata";
import { looseAlbum, planUpload, uploadLabel, type PickedFile, type PlanItem, type SkipReason } from "./plan";
import { Aborted, NetworkError, SessionExpired, uploadResumable, type Send, type SendResult } from "./resumable";
import type { Analysis, WorkerJob, WorkerRequest, WorkerResponse } from "./worker-protocol";

/*
 * Motore della pagina "Carica dal browser". Fa nel browser quello che il
 * programma di import fa sul computer, parlando con la stessa API:
 *
 *  1. appena scelti i file: impronta SHA-256 di tutti (in un Web Worker) e
 *     ricerca di quelli già nell'archivio, per il riepilogo;
 *  2. "Inizia": per ogni file nuovo tag EXIF e anteprime (worker), upload
 *     delle anteprime e registrazione della foto con l'originale "in arrivo":
 *     l'album è completo dopo pochi minuti;
 *  3. intanto, e poi a piena velocità, gli originali con l'upload
 *     riprendibile di Cloud Storage. Ricaricando la stessa cartella dopo una
 *     chiusura, i file già arrivati si saltano e gli originali a metà
 *     ripartono da dove erano.
 */

export type FileState =
  | "waiting"
  | "hash"
  | "check"
  | "previews"
  | "upload_previews"
  | "commit"
  | "original_queued"
  | "upload_original"
  | "done"
  | "existing"
  | "error";

export type UploadItem = PlanItem & {
  id: number;
  sha?: string;
  state: FileState;
  /** Già nell'archivio secondo la ricerca iniziale (null = non ancora controllato). */
  known: "new" | "existing" | "pending_original" | null;
  /** Byte dell'originale arrivati a Cloud Storage. */
  received: number;
  error?: string;
};

export type Phase = "empty" | "reading" | "ready" | "running" | "paused" | "finished";

export type Snapshot = {
  phase: Phase;
  items: UploadItem[];
  skipped: Record<SkipReason, number>;
  roots: string[];
  looseTitle: string;
  hashed: number;
  /** La ricerca dei file già presenti è finita. */
  lookedUp: boolean;
  importId: string | null;
  uploadBps: number;
  result: { matched: number; duplicates: number } | null;
  fatal: string | null;
  /** File letti durante il trascinamento di cartelle grandi. */
  readingCount: number;
};

const API = "/api/import/v1";
/** File lavorati insieme per le anteprime (lettura, anteprime, upload piccoli). */
const PREVIEW_PARALLEL = 3;
/** Originali caricati insieme: 1 mentre si fanno ancora le anteprime, poi 2. */
const ORIGINAL_PARALLEL_DURING = 1;
const ORIGINAL_PARALLEL_AFTER = 2;

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

class FatalError extends Error {}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------

async function api<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", [PROGRAM_VERSION_HEADER]: String(PROGRAM_VERSION) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      if (attempt >= 4) throw new Error("Server non raggiungibile: controlla la connessione.");
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok) return data as T;
    if (res.status === 401) throw new FatalError("Sessione scaduta: accedi di nuovo e trascina di nuovo i file.");
    if ((res.status >= 500 || res.status === 429) && attempt < 4) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status);
  }
}

/** Una richiesta con XMLHttpRequest (fetch non dà l'avanzamento dell'upload). */
function xhrSender(active: Set<XMLHttpRequest>): Send {
  return ({ method, url, headers, body, onProgress }) =>
    new Promise<SendResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      active.add(xhr);
      xhr.open(method, url);
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => onProgress?.(e.loaded);
      const done = () => active.delete(xhr);
      xhr.onload = () => {
        done();
        resolve({ status: xhr.status, header: (n) => xhr.getResponseHeader(n) });
      };
      xhr.onerror = () => {
        done();
        reject(new NetworkError());
      };
      xhr.ontimeout = xhr.onerror;
      xhr.onabort = () => {
        done();
        reject(new Aborted());
      };
      xhr.send(body);
    });
}

function crossOrigin(url: string): boolean {
  try {
    return new URL(url, location.href).origin !== location.origin;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------

class WorkerPool {
  private workers: { w: Worker; busy: number }[] = [];
  private pending = new Map<number, { resolve: (r: WorkerResponse) => void }>();
  private nextId = 1;

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      const slot = { w, busy: 0 };
      w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        slot.busy--;
        this.pending.get(ev.data.id)?.resolve(ev.data);
        this.pending.delete(ev.data.id);
      };
      this.workers.push(slot);
    }
  }

  private run(req: WorkerJob): Promise<WorkerResponse> {
    const slot = this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
    const id = this.nextId++;
    slot.busy++;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      slot.w.postMessage({ ...req, id } as WorkerRequest);
    });
  }

  async hash(file: Blob): Promise<string> {
    const r = await this.run({ op: "hash", file });
    if (!r.ok) throw new Error(r.error);
    if (!("sha256" in r)) throw new Error("Risposta inattesa dal worker.");
    return r.sha256;
  }

  async analyze(file: Blob, name: string, mime: string, wasmUrl: string): Promise<Analysis> {
    const r = await this.run({ op: "analyze", file, name, mime, wasmUrl });
    if (!r.ok) throw new Error(r.error);
    if (!("analysis" in r)) throw new Error("Risposta inattesa dal worker.");
    return r.analysis;
  }

  terminate() {
    for (const { w } of this.workers) w.terminate();
    this.workers = [];
  }
}

// ---------------------------------------------------------------------
// Motore
// ---------------------------------------------------------------------

export class UploadEngine {
  private items: UploadItem[] = [];
  private skipped: Record<SkipReason, number> = { video: 0, other: 0, system: 0 };
  private roots: string[] = [];
  private looseTitle: string;
  private phase: Phase = "empty";
  private hashed = 0;
  private lookedUp = false;
  private importId: string | null = null;
  private result: Snapshot["result"] = null;
  private fatal: string | null = null;
  private readingCount = 0;

  private pool: WorkerPool | null = null;
  private hashes = new Map<number, Promise<string>>();
  private xhrs = new Set<XMLHttpRequest>();
  private send = xhrSender(this.xhrs);
  private paused = false;
  private generation = 0;
  private previewsRunning = 0;
  private originalsQueue: UploadItem[] = [];
  private uploadMeter = new RateMeter(20_000);
  private doneMeter = new RateMeter(60_000);
  private ticker: ReturnType<typeof setInterval> | null = null;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private corsHint = false;

  constructor(
    private readonly opts: { wasmUrl: string; defaultLooseTitle: string; onChange: (s: Snapshot) => void },
  ) {
    this.looseTitle = opts.defaultLooseTitle;
  }

  // --- stato per l'interfaccia ---------------------------------------

  snapshot(): Snapshot {
    return {
      phase: this.phase,
      items: this.items,
      skipped: this.skipped,
      roots: this.roots,
      looseTitle: this.looseTitle,
      hashed: this.hashed,
      lookedUp: this.lookedUp,
      importId: this.importId,
      uploadBps: this.uploadMeter.rate(),
      result: this.result,
      fatal: this.fatal,
      readingCount: this.readingCount,
    };
  }

  /** Avvisa l'interfaccia, al massimo ~5 volte al secondo. */
  private changed(now = false) {
    if (now) {
      if (this.emitTimer) clearTimeout(this.emitTimer);
      this.emitTimer = null;
      this.opts.onChange(this.snapshot());
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.opts.onChange(this.snapshot());
    }, 200);
  }

  private set(item: UploadItem, state: FileState, extra: Partial<UploadItem> = {}) {
    Object.assign(item, { state, ...extra });
    this.changed();
  }

  private workers(): WorkerPool {
    if (!this.pool) {
      const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
      this.pool = new WorkerPool(Math.max(1, Math.min(2, cores - 1)));
    }
    return this.pool;
  }

  dispose() {
    this.paused = true;
    for (const x of this.xhrs) x.abort();
    this.pool?.terminate();
    this.pool = null;
    if (this.ticker) clearInterval(this.ticker);
  }

  // --- scelta dei file e riepilogo --------------------------------------

  setReading(n: number) {
    this.phase = "reading";
    this.readingCount = n;
    this.changed();
  }

  /** Nuovi file scelti: si aggiungono a quelli già in elenco (prima di iniziare). */
  add(picked: PickedFile[]) {
    if (this.phase === "running" || this.phase === "paused") return;
    const known = new Set(this.items.map((i) => i.path));
    const plan = planUpload(picked.filter((p) => !known.has(p.path)));
    let id = this.items.length;
    for (const it of plan.items) this.items.push({ ...it, id: id++, state: "waiting", known: null, received: 0 });
    for (const k of Object.keys(plan.skipped) as SkipReason[]) this.skipped[k] += plan.skipped[k];
    this.roots = [...new Set([...this.roots, ...plan.roots])].sort();
    this.phase = this.items.length ? "ready" : "empty";
    this.lookedUp = false;
    this.changed(true);
    void this.prescan();
  }

  setLooseTitle(title: string) {
    this.looseTitle = title;
    this.changed();
  }

  clear() {
    if (this.phase === "running") return;
    this.items = [];
    this.skipped = { video: 0, other: 0, system: 0 };
    this.roots = [];
    this.hashes.clear();
    this.hashed = 0;
    this.lookedUp = false;
    this.importId = null;
    this.result = null;
    this.fatal = null;
    this.phase = "empty";
    this.changed(true);
  }

  private hashOf(item: UploadItem): Promise<string> {
    let p = this.hashes.get(item.id);
    if (!p) {
      p = this.workers()
        .hash(item.file)
        .then((sha) => {
          item.sha = sha;
          this.hashed++;
          this.changed();
          return sha;
        });
      p.catch(() => this.hashes.delete(item.id));
      this.hashes.set(item.id, p);
    }
    return p;
  }

  /** Impronte di tutti i file e ricerca di quelli già presenti, per il riepilogo. */
  private async prescan() {
    const gen = ++this.generation;
    const todo = this.items.filter((i) => !i.sha);
    for (const item of todo) {
      if (gen !== this.generation) return;
      try {
        await this.hashOf(item);
      } catch (e) {
        this.set(item, "error", { error: `Impronta non calcolata: ${(e as Error).message}` });
      }
    }
    const unknown = this.items.filter((i) => i.sha && i.known === null);
    try {
      for (let i = 0; i < unknown.length; i += 1000) {
        const batch = unknown.slice(i, i + 1000);
        const res = await api<ExistingFiles>("POST", "/lookup", { sha256: batch.map((b) => b.sha) });
        const existing = new Set(res.existing);
        const pending = new Set(res.pendingOriginals);
        for (const b of batch) {
          b.known = pending.has(b.sha!) ? "pending_original" : existing.has(b.sha!) ? "existing" : "new";
        }
      }
      if (gen === this.generation) this.lookedUp = true;
    } catch (e) {
      if (e instanceof FatalError) this.fatal = e.message;
    }
    this.changed(true);
  }

  // --- caricamento -------------------------------------------------------

  async start() {
    if (this.phase === "running" || this.items.length === 0) return;
    this.fatal = null;
    this.result = null;
    this.paused = false;
    try {
      const started = await api<{ publicId: string }>("POST", "/imports", {
        source: "cr2_disk",
        label: uploadLabel(this.roots, this.items.filter((i) => i.loose).length),
        // Un import lasciato a metà (pausa, errori) riprende lo stesso.
        resume: this.importId ?? undefined,
      });
      this.importId = started.publicId;
    } catch (e) {
      this.fatal = (e as Error).message;
      this.changed(true);
      return;
    }
    this.phase = "running";
    this.changed(true);
    this.ticker ??= setInterval(() => void this.report(), 3000);
    const loose = looseAlbum(this.looseTitle);
    for (const item of this.items) if (item.loose) item.album = loose;

    const queue = this.items.filter((i) => i.state === "waiting");
    // Gli originali già in coda (pausa) restano in coda.
    this.originalsQueue = this.items.filter((i) => i.state === "original_queued");
    let next = 0;
    this.previewsRunning = PREVIEW_PARALLEL;
    const previewWorker = async () => {
      while (!this.paused && !this.fatal && next < queue.length) {
        await this.processPreview(queue[next++]);
      }
      this.previewsRunning--;
    };
    const originalWorker = async (n: number) => {
      for (;;) {
        if (this.paused || this.fatal) return;
        // Mentre si fanno le anteprime ne va uno solo, per non rallentarle.
        const allowed = this.previewsRunning > 0 ? ORIGINAL_PARALLEL_DURING : ORIGINAL_PARALLEL_AFTER;
        const item = n < allowed ? this.originalsQueue.shift() : undefined;
        if (!item) {
          if (this.previewsRunning === 0 && (n >= allowed || this.originalsQueue.length === 0)) return;
          await sleep(500);
          continue;
        }
        await this.processOriginal(item);
      }
    };
    await Promise.all([
      ...Array.from({ length: PREVIEW_PARALLEL }, previewWorker),
      ...Array.from({ length: ORIGINAL_PARALLEL_AFTER }, (_, i) => originalWorker(i)),
    ]);
    await this.report();
    if (this.paused) {
      this.phase = "paused";
      this.changed(true);
      return;
    }
    await this.finish();
  }

  pause() {
    if (this.phase !== "running") return;
    this.paused = true;
    // Gli upload in corso si fermano subito: gli originali riprenderanno
    // dal punto in cui sono arrivati, le anteprime si rifanno (sono piccole).
    for (const x of this.xhrs) x.abort();
    this.changed(true);
  }

  resume() {
    if (this.phase === "paused" || this.phase === "finished") void this.start();
  }

  retryErrors() {
    if (this.phase === "running") return;
    for (const it of this.items) {
      // Si riparte dal controllo: chi ha già le anteprime passa subito all'originale.
      if (it.state === "error") Object.assign(it, { state: "waiting", error: undefined });
    }
    void this.start();
  }

  private async finish() {
    const errors = this.items.filter((i) => i.state === "error").length;
    try {
      const done = await api<{ matched: number; duplicates?: number }>("POST", `/imports/${this.importId}/finish`, {
        // Con errori l'import resta riprendibile ("Riprova gli errori").
        status: errors ? "interrupted" : "finished",
        log: this.logText(),
      });
      this.result = { matched: done.matched, duplicates: done.duplicates ?? 0 };
    } catch (e) {
      this.fatal = (e as Error).message;
    }
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.phase = "finished";
    this.changed(true);
  }

  private logText(): string {
    const count = (s: FileState) => this.items.filter((i) => i.state === s).length;
    const bytes = this.items.filter((i) => i.state === "done").reduce((s, i) => s + i.size, 0);
    return [
      `Caricamento dal browser: ${this.items.length} file`,
      `Nuovi: ${count("done")} · già presenti: ${count("existing")} · errori: ${count("error")}`,
      `Originali caricati: ${(bytes / 1e9).toFixed(2)} GB`,
      this.skipped.video ? `Video ignorati: ${this.skipped.video}` : null,
      this.skipped.other ? `Altri file ignorati: ${this.skipped.other}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async fail(item: UploadItem, e: unknown) {
    if (e instanceof FatalError) {
      this.fatal = e.message;
      this.set(item, "waiting");
      return;
    }
    let message = (e as Error)?.message || String(e);
    if (this.corsHint) {
      message =
        "Il bucket di Google Cloud non accetta caricamenti dal browser: va impostata la regola CORS (vedi docs/architettura.md, «Carica dal browser»).";
    }
    this.set(item, "error", { error: message });
    await api("POST", `/imports/${this.importId}/errors`, { sourcePath: item.path, message: message.slice(0, 2000) }).catch(
      () => {},
    );
  }

  /** PUT semplice (anteprime, archivio di prova) con qualche tentativo. */
  private async put(target: UploadTarget, body: Blob, onProgress?: (sent: number) => void) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.send({ method: "PUT", url: target.url, headers: target.headers, body, onProgress });
        if (res.status >= 200 && res.status < 300) return;
        if (res.status < 500 && res.status !== 429) throw new Error(`Upload rifiutato (HTTP ${res.status}).`);
      } catch (e) {
        if (e instanceof Aborted) throw e;
        if (!(e instanceof NetworkError)) throw e;
        if (attempt >= 3) {
          // Un errore di rete subito, verso un altro dominio, è quasi sempre il CORS del bucket.
          if (crossOrigin(target.url)) this.corsHint = true;
          throw new Error("Upload non riuscito: connessione interrotta.");
        }
      }
      if (attempt >= 3) throw new Error("Upload non riuscito dopo più tentativi.");
      await sleep(1000 * 2 ** attempt);
    }
  }

  private async processPreview(item: UploadItem) {
    const id = this.importId!;
    try {
      this.set(item, "hash");
      const sha = await this.hashOf(item);
      this.set(item, "check");
      const check = await api<ExistingFiles>("POST", `/imports/${id}/check`, {
        items: [{ sha256: sha, album: item.album }],
      });
      if (check.pendingOriginals.includes(sha)) {
        this.set(item, "original_queued");
        this.originalsQueue.push(item);
        return;
      }
      if (check.existing.includes(sha)) {
        this.set(item, "existing");
        this.doneMeter.add(item.size);
        return;
      }

      this.set(item, "previews");
      const a = await this.workers().analyze(item.file, item.name, item.mime, this.opts.wasmUrl);
      const fields = photoFields(a.tags);
      if (this.paused) throw new Aborted();

      this.set(item, "upload_previews");
      const targets = await api<{ preview: UploadTarget | null; thumb: UploadTarget | null }>(
        "POST",
        `/imports/${id}/prepare`,
        { sha256: sha, filename: item.name, takenAt: fields.takenAt, mime: item.mime, withPreview: true },
      );
      if (!targets.preview || !targets.thumb) throw new Error("Il server non ha dato dove caricare le anteprime.");
      await this.put(targets.preview, a.preview, (n) => this.uploadMeter.add(n));
      await this.put(targets.thumb, a.thumb);
      this.uploadMeter.add(a.thumb.size);

      this.set(item, "commit");
      const body: CommitBody = {
        sha256: sha,
        filename: item.name,
        sourcePath: item.path,
        size: item.size,
        mime: item.mime,
        ...fields,
        exif: exifJson(a.tags),
        withPreview: true,
        originalPending: true,
        album: item.album as AlbumRef | null,
      };
      const res = await api<{ duplicate: boolean }>("POST", `/imports/${id}/commit`, body);
      if (res.duplicate) {
        // Registrata intanto da un'altra parte (stesso file due volte): niente originale da mandare.
        this.set(item, "existing");
        return;
      }
      this.set(item, "original_queued");
      this.originalsQueue.push(item);
    } catch (e) {
      if (e instanceof Aborted) this.set(item, "waiting");
      else await this.fail(item, e);
    }
  }

  private async processOriginal(item: UploadItem) {
    const id = this.importId!;
    const sha = item.sha!;
    try {
      this.set(item, "upload_original");
      let fresh = false;
      for (;;) {
        const where = await api<OriginalTarget>("POST", `/imports/${id}/original`, { sha256: sha, fresh });
        let last = item.received;
        const onProgress = (received: number) => {
          if (received > last) this.uploadMeter.add(received - last);
          last = received;
          item.received = received;
          this.changed();
        };
        try {
          if (where.kind === "put") {
            await this.put(where.target, item.file, onProgress);
          } else {
            await uploadResumable({ url: where.url, file: item.file, send: this.send, onProgress, isAborted: () => this.paused });
          }
          break;
        } catch (e) {
          // Sessione scaduta (più di una settimana, o annullata da Google): se ne apre una nuova, una volta.
          if (e instanceof SessionExpired && !fresh) {
            fresh = true;
            item.received = 0;
            continue;
          }
          if (e instanceof NetworkError && where.kind === "resumable" && crossOrigin(where.url) && item.received === 0) {
            this.corsHint = true;
          }
          throw e;
        }
      }
      this.set(item, "commit");
      await api("POST", `/imports/${id}/original/done`, { sha256: sha });
      this.doneMeter.add(item.size);
      this.set(item, "done", { received: item.size });
    } catch (e) {
      if (e instanceof Aborted) {
        this.set(item, "original_queued");
        this.originalsQueue.unshift(item);
      } else {
        await this.fail(item, e);
      }
    }
  }

  // --- avanzamento nella pagina Import ------------------------------------

  private static STEP: Partial<Record<FileState, ImportStep>> = {
    hash: "hash",
    check: "check",
    previews: "previews",
    upload_previews: "upload_previews",
    commit: "commit",
    upload_original: "upload_original",
  };

  private async report() {
    if (!this.importId) return;
    const finished = (i: UploadItem) => i.state === "done" || i.state === "existing" || i.state === "error";
    const active = this.items.filter((i) => UploadEngine.STEP[i.state]).slice(0, 16);
    const activity: ImportActivity = {
      workers: active.map((i) => ({
        file: i.path.slice(0, 1024),
        step: UploadEngine.STEP[i.state]!,
        size: i.size,
        ...(i.state === "upload_original" ? { sent: i.received } : {}),
      })),
      uploadBps: Math.round(this.uploadMeter.rate()),
      doneBps: Math.round(this.doneMeter.rate()),
      parallel: PREVIEW_PARALLEL + ORIGINAL_PARALLEL_AFTER,
    };
    const done = this.items.filter(finished);
    await api("PATCH", `/imports/${this.importId}`, {
      filesSeen: done.length,
      filesTotal: this.items.length,
      bytesTotal: this.items.reduce((s, i) => s + i.size, 0),
      bytesDone: done.reduce((s, i) => s + i.size, 0),
      currentFile: active[0]?.path.slice(0, 1024) ?? null,
      activity: this.phase === "running" && active.length ? activity : null,
    }).catch(() => {});
    this.changed();
  }
}
