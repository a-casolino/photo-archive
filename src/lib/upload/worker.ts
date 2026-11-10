/// <reference lib="webworker" />
/*
 * Web Worker della pagina "Carica dal browser": impronta, tag EXIF e
 * anteprime, fuori dal thread della pagina così l'interfaccia resta fluida.
 * Un lavoro alla volta per worker (ExifTool usa un solo interprete).
 */
import { PREVIEW_LONG_SIDE, THUMB_LONG_SIDE } from "../import-shared";
import { decodeHeic } from "./heic";
import { embeddedJpegRange, fitInside, orientationTransform } from "./image-rules";
import { EXIFTOOL_ARGS, type Analysis, type WorkerRequest, type WorkerResponse } from "./worker-protocol";

declare const self: DedicatedWorkerGlobalScope;

type ExifToolModule = typeof import("@uswriting/exiftool");
let exiftool: Promise<ExifToolModule> | null = null;
let wasm: Promise<ArrayBuffer> | null = null;

function loadExifTool(): Promise<ExifToolModule> {
  // zeroperl sceglie come caricare il WebAssembly guardando se c'è una
  // finestra: in un worker non c'è, e proverebbe le API di Node.
  const g = self as unknown as { window?: unknown; document?: unknown };
  g.window ??= self;
  g.document ??= {};
  return (exiftool ??= import("@uswriting/exiftool"));
}

async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const FILE_DROP = new Set(["SourceFile", "Directory", "FileName", "FileModifyDate", "FileAccessDate", "FileInodeChangeDate", "FilePermissions"]);

/**
 * Scarica ExifTool. Il server lo manda compresso con gzip (vedi
 * /api/import/exiftool). Se la cache del browser fallisce (capita con due
 * worker che lo scaricano insieme) si riprova senza cache.
 */
async function downloadWasm(url: string): Promise<ArrayBuffer> {
  let last: unknown;
  for (const cache of ["default", "no-store", "no-store"] as const) {
    try {
      const r = await fetch(url, { credentials: "same-origin", cache });
      if (!r.ok || !r.body) throw new Error(`ExifTool non scaricato (HTTP ${r.status}).`);
      return await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`ExifTool non scaricato: ${(last as Error)?.message ?? last}`);
}

async function readTags(file: Blob, name: string, wasmUrl: string): Promise<Record<string, unknown>> {
  const { parseMetadata } = await loadExifTool();
  const ext = (name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  // Nome semplice nel file system virtuale di ExifTool; il contenuto non viene copiato.
  const named = new File([file], `foto.${ext}`);
  const result = await parseMetadata<Record<string, unknown>[]>(named, {
    args: EXIFTOOL_ARGS,
    transform: (data) => JSON.parse(data),
    fetch: async () => {
      wasm ??= downloadWasm(wasmUrl);
      const buf = await wasm.catch((e) => {
        wasm = null;
        throw e;
      });
      return new Response(buf.slice(0), { headers: { "Content-Type": "application/wasm" } });
    },
  });
  if (!result.success) throw new Error(`Lettura EXIF non riuscita: ${result.error}`);
  const tags = { ...(result.data[0] ?? {}) };
  for (const k of FILE_DROP) delete tags[k];
  return tags;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function makePreviews(file: Blob, mime: string, tags: Record<string, unknown>) {
  const raw = mime === "image/x-canon-cr2" || mime === "image/x-adobe-dng";
  let source = "file";
  let blob = file;
  if (raw) {
    // Il JPEG a piena risoluzione dentro il CR2: non porta l'orientamento,
    // lo si applica a mano come fa il programma di import.
    const range = embeddedJpegRange(tags);
    if (!range) throw new Error("CR2 illeggibile: nessuna anteprima incorporata (file rovinato?).");
    blob = file.slice(range.start, range.start + range.length, "image/jpeg");
    source = range.tag;
  }
  let bitmap: ImageBitmap;
  try {
    // Per JPG/PNG/HEIC il browser applica da solo l'orientamento EXIF.
    bitmap = await createImageBitmap(blob);
  } catch {
    if (!/heic|heif/.test(mime)) throw new Error("Immagine non leggibile dal browser.");
    // Chrome, Edge e Firefox non aprono i HEIC: ci pensa libheif.
    bitmap = await decodeHeic(blob);
  }
  const fit = fitInside(bitmap.width, bitmap.height, PREVIEW_LONG_SIDE);
  const t = orientationTransform(raw ? num(tags.Orientation) : null, fit.w, fit.h);
  const canvas = new OffscreenCanvas(t.width, t.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas non disponibile in questo browser.");
  ctx.fillStyle = "#fff"; // PNG trasparenti: fondo bianco nel JPEG
  ctx.fillRect(0, 0, t.width, t.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.setTransform(...t.matrix);
  ctx.drawImage(bitmap, 0, 0, fit.w, fit.h);
  bitmap.close();
  const preview = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });

  const tf = fitInside(t.width, t.height, THUMB_LONG_SIDE);
  const small = new OffscreenCanvas(tf.w, tf.h);
  const sctx = small.getContext("2d");
  if (!sctx) throw new Error("Canvas non disponibile in questo browser.");
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(canvas, 0, 0, tf.w, tf.h);
  const thumb = await small.convertToBlob({ type: "image/jpeg", quality: 0.75 });
  return { preview, thumb, source };
}

async function handle(req: WorkerRequest): Promise<WorkerResponse> {
  try {
    if (req.op === "hash") return { id: req.id, ok: true, sha256: await sha256(req.file) };
    const tags = await readTags(req.file, req.name, req.wasmUrl);
    const previews = await makePreviews(req.file, req.mime, tags);
    const analysis: Analysis = { tags, ...previews };
    return { id: req.id, ok: true, analysis };
  } catch (e) {
    return { id: req.id, ok: false, error: (e as Error)?.message || String(e) };
  }
}

let queue: Promise<void> = Promise.resolve();
self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  queue = queue.then(async () => self.postMessage(await handle(ev.data)));
};
