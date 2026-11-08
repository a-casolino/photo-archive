/**
 * Programma di import: gira sul computer di Antonio.
 *
 *   npm run import -- "/Volumes/Disco foto" [--etichetta "Disco WD 1TB"]
 *   npm run import -- "/Users/antonio/Takeout" --takeout
 *
 * Opzioni:
 *   --takeout        la cartella è un Google Takeout già estratto
 *   --etichetta "…"  nome dell'import nella pagina Import
 *   --prova          non carica nulla: conta i file e crea 10 anteprime
 *                    di esempio in ./prova-import per controllarle
 *   --paralleli N    file lavorati insieme (predefinito 3)
 *   --max N          importa al massimo N file (per provare)
 *   --senza-album    non crea album dalle cartelle
 *   --nuovo          non riprendere l'import interrotto, iniziane uno nuovo
 *
 * Configurazione in .env.local: IMPORT_SERVER_URL e IMPORT_KEY (la chiave
 * creata nella pagina Import dell'app).
 */
import "../load-env";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { ExifTool } from "exiftool-vendored";
import {
  RateMeter,
  type CommitBody,
  type ImportActivity,
  type ImportSource,
  type ImportStep,
  type UploadTarget,
} from "../../src/lib/import-shared";
import { Api, FatalError } from "./api";
import { exifJson, photoFields, romeLocalString, type Tags } from "./metadata";
import { makePreviews } from "./previews";
import { scan, type FileEntry } from "./scan";
import { HashCache, lastOpenImport, rememberImport, sha256File } from "./state";
import { parseSidecar, type TakeoutSidecar } from "./takeout";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    takeout: { type: "boolean", default: false },
    etichetta: { type: "string" },
    prova: { type: "boolean", default: false },
    paralleli: { type: "string", default: "3" },
    max: { type: "string" },
    "senza-album": { type: "boolean", default: false },
    nuovo: { type: "boolean", default: false },
  },
});

const fmtBytes = (b: number) =>
  b >= 1e12 ? `${(b / 1e12).toFixed(2)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(1)} MB`;

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

async function main() {
  if (positionals.length !== 1) fail('Indica la cartella da importare, es.: npm run import -- "/Volumes/Disco foto"');
  const root = path.resolve(positionals[0]);
  if (!(await stat(root).catch(() => null))?.isDirectory()) fail(`La cartella non esiste: ${root}`);
  const source: ImportSource = opts.takeout ? "google_takeout" : "cr2_disk";
  const parallel = Math.max(1, Math.min(8, Number(opts.paralleli) || 3));
  const max = opts.max ? Number(opts.max) : Infinity;

  console.log(`\nArchivio foto: import ${source === "cr2_disk" ? "CR2 dal disco" : "Google Takeout"}`);
  console.log(`Cartella: ${root}\n`);

  process.stdout.write("Scansione…");
  const found = await scan(root, source, {
    albums: !opts["senza-album"],
    onProgress: (n) => n % 500 === 0 && process.stdout.write(`\rScansione… ${n} file`),
  });
  const files = found.files.slice(0, max);
  const bytesTotal = files.reduce((s, f) => s + f.size, 0);
  console.log(`\rTrovati ${files.length} file da importare (${fmtBytes(bytesTotal)}).`);
  if (found.videos) console.log(`Video ignorati (non ancora supportati): ${found.videos}`);
  if (found.ignored) console.log(`Altri file ignorati: ${found.ignored}`);
  if (files.length === 0) return;

  const et = new ExifTool({ maxProcs: parallel });
  try {
    if (opts.prova) await dryRun(et, files);
    else await runImport(et, root, source, files, bytesTotal, parallel, found.videos);
  } finally {
    await et.end();
  }
}

// ---------------------------------------------------------------------
// Prova: niente upload
// ---------------------------------------------------------------------

async function dryRun(et: ExifTool, files: FileEntry[]) {
  const out = path.resolve("prova-import");
  await mkdir(out, { recursive: true });
  const sample = files.filter((_, i) => i % Math.max(1, Math.floor(files.length / 10)) === 0).slice(0, 10);
  console.log(`\nProva: leggo ${sample.length} file e salvo le anteprime in ${out}\n`);
  for (const f of sample) {
    try {
      const info = await readInfo(et, f);
      const previews = await makePreviews(et, f.abs, f.mime, info.fields.orientation);
      const base = path.join(out, f.name.replace(/\.[^.]+$/, ""));
      if (previews) {
        await writeFile(`${base}_grande.jpg`, previews.preview);
        await writeFile(`${base}_mini.jpg`, previews.thumb);
      }
      const cam = info.fields.camera;
      console.log(
        `• ${f.rel}\n  scatto ${info.takenAt ?? "?"}${info.fields.takenAtSubsec !== null ? `,${info.fields.takenAtSubsec}` : ""}` +
          ` · ${cam ? `${cam.make} ${cam.model} (serie ${cam.serial || "—"})` : "fotocamera ?"}` +
          ` · orient. ${info.fields.orientation ?? "?"}` +
          ` · anteprima ${previews ? `da ${previews.source}, ${Math.round(previews.preview.length / 1024)} KB` : "NON disponibile"}` +
          (f.album ? `\n  album «${f.album.title}»` : ""),
      );
    } catch (e) {
      console.log(`• ${f.rel}\n  ERRORE: ${(e as Error).message}`);
    }
  }
  console.log("\nNessun file è stato caricato. Togli --prova per importare davvero.\n");
}

// ---------------------------------------------------------------------
// Import vero
// ---------------------------------------------------------------------

type Info = { fields: ReturnType<typeof photoFields>; tags: Tags; takenAt: string | null; extra: Partial<CommitBody> };

async function readInfo(et: ExifTool, f: FileEntry): Promise<Info> {
  const tags = (await et.read(f.abs)) as unknown as Tags;
  const fields = photoFields(tags);
  const extra: Partial<CommitBody> = {};
  let takenAt = fields.takenAt;
  if (f.sidecar) {
    const side = parseSidecar(JSON.parse(await readFile(f.sidecar, "utf8")) as TakeoutSidecar);
    extra.description = side.description;
    extra.googlePhotosUrl = side.googlePhotosUrl;
    if (!fields.takenAtUtc && side.takenAtUtc) extra.takenAtUtc = side.takenAtUtc;
    if (!takenAt && side.takenAtUtc) takenAt = romeLocalString(side.takenAtUtc);
    if (fields.gpsLat === null && side.gpsLat !== null) {
      extra.gpsLat = Math.round(side.gpsLat * 1e6) / 1e6;
      extra.gpsLon = side.gpsLon === null ? null : Math.round(side.gpsLon * 1e6) / 1e6;
    }
  }
  return { fields, tags, takenAt, extra };
}

async function runImport(
  et: ExifTool,
  root: string,
  source: ImportSource,
  files: FileEntry[],
  bytesTotal: number,
  parallel: number,
  videos: number,
) {
  const server = process.env.IMPORT_SERVER_URL;
  const key = process.env.IMPORT_KEY;
  if (!server || !key) {
    fail("Mancano IMPORT_SERVER_URL e IMPORT_KEY in .env.local (la chiave si crea nella pagina Import dell'app).");
  }
  const api = new Api(server, key);
  const ping = await api.call<{ device: string; storage: string }>("GET", "/ping");
  console.log(`Collegato a ${server} come «${ping.device}» (archivio: ${ping.storage === "gcs" ? "Google Cloud" : "cartella di prova"}).`);

  const resume = opts.nuovo ? undefined : await lastOpenImport(server, source, root);
  const label = opts.etichetta ?? `${source === "cr2_disk" ? "Disco" : "Takeout"} ${path.basename(root)}`;
  const started = await api.call<{ publicId: string; resumed: boolean }>("POST", "/imports", {
    source,
    label,
    rootPath: root,
    resume,
  });
  const id = started.publicId;
  await rememberImport(server, source, root, id);
  console.log(`${started.resumed ? "Riprendo" : "Inizio"} l'import «${label}»: ${new URL(`/admin/import/${id}`, server)}\n`);

  const cache = await HashCache.load();
  const stats = { seen: 0, bytesDone: 0, imported: 0, skipped: 0, failed: 0, noPreview: 0, uploaded: 0 };
  let stopping = false;
  /** Cosa sta facendo ogni lavoro in parallelo (null = libero). */
  const slots: ({ file: string; step: ImportStep; size: number; sent?: number } | null)[] = Array(parallel).fill(null);
  const uploadMeter = new RateMeter(20_000);
  const doneMeter = new RateMeter(60_000);
  const current = () => slots.find((x) => x)?.file ?? null;
  const activity = (): ImportActivity => ({
    workers: slots.filter((x) => x !== null),
    uploadBps: Math.round(uploadMeter.rate()),
    doneBps: Math.round(doneMeter.rate()),
    parallel,
  });
  const t0 = Date.now();

  process.on("SIGINT", () => {
    if (stopping) {
      console.log("\nUscita immediata.");
      process.exit(130);
    }
    stopping = true;
    console.log("\n\nMi fermo dopo i file in corso (Ctrl+C di nuovo per uscire subito)…");
  });

  const report = () =>
    api
      .call("PATCH", `/imports/${id}`, {
        filesSeen: stats.seen,
        filesTotal: files.length,
        bytesTotal,
        bytesDone: stats.bytesDone,
        currentFile: current(),
        activity: slots.some((x) => x) ? activity() : null,
      })
      .catch(() => {});

  const printLine = () => {
    const pct = bytesTotal ? ((stats.bytesDone / bytesTotal) * 100).toFixed(1) : "0";
    process.stdout.write(
      `\r${pct}% · ${stats.seen}/${files.length} file · nuovi ${stats.imported} · già presenti ${stats.skipped} · errori ${stats.failed} · caricati ${fmtBytes(stats.uploaded)} · ${fmtBytes(uploadMeter.rate())}/s   `,
    );
  };
  const ticker = setInterval(() => {
    printLine();
    void report();
  }, 2000);

  async function processFile(f: FileEntry, slot: number) {
    const state: { file: string; step: ImportStep; size: number; sent?: number } = { file: f.rel, step: "hash", size: f.size };
    slots[slot] = state;
    const step = (s: ImportStep) => {
      state.step = s;
      state.sent = undefined;
    };
    let sha = cache.get(f.abs, f.size, f.mtimeMs);
    if (!sha) {
      sha = await sha256File(f.abs);
      await cache.set(f.abs, f.size, f.mtimeMs, sha);
    }
    step("check");
    const check = await api.call<{ existing: string[] }>("POST", `/imports/${id}/check`, {
      items: [{ sha256: sha, album: f.album }],
    });
    if (check.existing.includes(sha)) {
      stats.skipped++;
      return;
    }

    step("exif");
    const info = await readInfo(et, f);
    step("previews");
    let previews = null;
    try {
      previews = await makePreviews(et, f.abs, f.mime, info.fields.orientation);
    } catch {
      previews = null;
    }
    if (!previews) {
      // Un CR2 sano ha sempre un JPEG incorporato: se manca, il file è rovinato.
      if (f.mime === "image/x-canon-cr2") throw new Error("CR2 illeggibile: nessuna anteprima incorporata (file rovinato?).");
      stats.noPreview++;
    }

    step("upload_previews");
    const targets = await api.call<{ original: UploadTarget; preview: UploadTarget | null; thumb: UploadTarget | null }>(
      "POST",
      `/imports/${id}/prepare`,
      { sha256: sha, filename: f.name, takenAt: info.takenAt, mime: f.mime, withPreview: !!previews },
    );
    if (previews && targets.preview && targets.thumb) {
      const onBytes = (n: number) => uploadMeter.add(n);
      await api.upload(targets.preview, previews.preview, { onBytes });
      await api.upload(targets.thumb, previews.thumb, { onBytes });
    }
    step("upload_original");
    state.sent = 0;
    await api.upload(
      targets.original,
      { file: f.abs, size: f.size },
      {
        onBytes: (n) => {
          uploadMeter.add(n);
          state.sent = (state.sent ?? 0) + n;
        },
        onRetry: () => (state.sent = 0),
      },
    );
    stats.uploaded += f.size;
    step("commit");

    const body: CommitBody = {
      sha256: sha,
      filename: f.name,
      sourcePath: f.rel,
      size: f.size,
      mime: f.mime,
      ...info.fields,
      takenAt: info.takenAt,
      exif: exifJson(info.tags),
      withPreview: !!previews,
      album: f.album,
      ...info.extra,
    };
    const res = await api.call<{ duplicate: boolean }>("POST", `/imports/${id}/commit`, body);
    if (res.duplicate) stats.skipped++;
    else stats.imported++;
  }

  let next = 0;
  async function worker(slot: number) {
    while (!stopping && next < files.length) {
      const f = files[next++];
      try {
        await processFile(f, slot);
      } catch (e) {
        if (e instanceof FatalError) {
          stopping = true;
          throw e;
        }
        stats.failed++;
        const message = (e as Error).message || String(e);
        await api.call("POST", `/imports/${id}/errors`, { sourcePath: f.rel, message }).catch(() => {});
      } finally {
        slots[slot] = null;
        stats.seen++;
        stats.bytesDone += f.size;
        doneMeter.add(f.size);
      }
    }
  }

  let fatal: unknown = null;
  await Promise.all(Array.from({ length: parallel }, (_, i) => worker(i).catch((e) => (fatal = e))));
  clearInterval(ticker);
  printLine();
  await report();

  const status = fatal ? "failed" : stopping && next < files.length ? "interrupted" : "finished";
  const elapsed = Math.round((Date.now() - t0) / 60_000);
  const log = [
    `Cartella: ${root}`,
    `File trovati: ${files.length} (${fmtBytes(bytesTotal)}), lavorati in questa sessione: ${stats.seen}`,
    `Nuovi: ${stats.imported} · già presenti: ${stats.skipped} · errori: ${stats.failed}`,
    `Caricati: ${fmtBytes(stats.uploaded)} in ${elapsed} min`,
    stats.noPreview ? `Senza anteprima: ${stats.noPreview}` : null,
    videos ? `Video ignorati: ${videos}` : null,
    fatal ? `Interrotto per errore: ${(fatal as Error).message}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const done = await api.call<{ matched: number; duplicates?: number }>("POST", `/imports/${id}/finish`, { status, log });
  if (status === "finished") await rememberImport(server, source, root, null);

  console.log(`\n\n${log}`);
  if (done.matched) console.log(`Export collegati in automatico al loro CR2: ${done.matched}`);
  if (done.duplicates) {
    console.log(`Probabili doppioni da rivedere nell'archivio: ${done.duplicates} (${new URL("/admin/import/doppioni", server)})`);
  }
  console.log(
    status === "finished"
      ? "\n✓ Import completato."
      : status === "interrupted"
        ? "\nImport interrotto: rilancia lo stesso comando per continuare."
        : "\n✗ Import fermato per errore.",
  );
  if (stats.failed) console.log("Gli errori sono elencati nella pagina dell'import; rilanciando, i file con errore vengono ritentati.");
  if (fatal) process.exitCode = 1;
}

main().catch((e) => {
  if (e instanceof FatalError) fail(e.message);
  console.error(e);
  process.exit(1);
});
