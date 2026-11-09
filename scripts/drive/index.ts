/**
 * Import da Google Drive: gira sulla VPS (cron ogni 15 minuti, a bassa
 * priorità) e lavora la coda della pagina Import → Google Drive.
 *
 *   nice -n 15 npm run drive
 *
 * Per ogni elemento in coda:
 *  - export di Google Takeout: legge gli zip direttamente da Drive, a pezzi
 *    (niente zip interi sul disco). Prima estrae tutti i JSON (album, date,
 *    posizioni: Google li mette a volte in uno zip diverso dalla foto), poi
 *    le foto a lotti;
 *  - cartella di Drive: scarica i file a lotti, con le sottocartelle.
 * Per ogni lotto lancia il normale programma di import (scripts/import) verso
 * l'app, con una chiave che si rinnova a ogni giro, poi cancella i file.
 *
 * Un solo giro alla volta (file di blocco). Se viene interrotto, il giro
 * successivo riprende dal primo lotto non finito.
 *
 * Configurazione (.env): DRIVE_WORK_DIR, DRIVE_BATCH_GB, GOOGLE_*, più
 * database e APP_URL come il sito.
 */
import "../load-env";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, statfs, unlink, utimes } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type yauzl from "yauzl";
import { newToken, sha256 } from "../../src/lib/crypto";
import { execute, pool, queryOne } from "../../src/lib/db";
import { DRIVE_DEVICE_NAME, makeBatches, safeSegment, uniqueName, zipEntrySegments } from "../../src/lib/drive-rules";
import { env } from "../../src/lib/env";
import { DriveClient, driveQuote, FOLDER_MIME } from "../../src/lib/google-drive";
import { mimeFor, VIDEO_EXT } from "../import/metadata";
import { openDriveZip, zipEntries } from "./zip-reader";

const MARGIN_BYTES = 2e9;

type Job = {
  id: number;
  public_id: string;
  kind: "takeout" | "folder";
  label: string;
  drive_ids: string[];
  batches_done: number;
  created_by: number;
};

/** Un file da mettere sul disco: da uno zip o da Drive. */
type Item = { size: number; dest: string; mtime: Date | null } & (
  | { from: "zip"; zip: yauzl.ZipFile; entry: yauzl.Entry }
  | { from: "drive"; fileId: string }
);

class Cancelled extends Error {}

const workDir = () => path.resolve(env().DRIVE_WORK_DIR);
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
const fmtGB = (b: number) => `${(b / 1e9).toFixed(1)} GB`;

// ---------------------------------------------------------------------
// Un giro alla volta
// ---------------------------------------------------------------------

async function takeLock(): Promise<(() => Promise<void>) | null> {
  const file = path.join(workDir(), "drive.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(file, "wx");
      await fh.write(String(process.pid));
      await fh.close();
      return () => unlink(file).catch(() => {});
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number(await readFile(file, "utf8").catch(() => ""));
      let alive = false;
      try {
        if (pid > 0) {
          process.kill(pid, 0);
          alive = true;
        }
      } catch {
        alive = false;
      }
      if (alive) return null;
      await unlink(file).catch(() => {}); // blocco rimasto da un giro morto
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// Stato in database
// ---------------------------------------------------------------------

async function setMessage(job: Job, message: string) {
  await execute("UPDATE drive_imports SET message = ?, heartbeat_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'running'", [
    message.slice(0, 1024),
    job.id,
  ]);
}

async function isCancelled(job: Job): Promise<boolean> {
  const row = await queryOne<{ status: string }>("SELECT status FROM drive_imports WHERE id = ?", [job.id]);
  return row?.status !== "running";
}

/** Chiave del programma di import per questo giro: si rinnova ogni volta, niente da salvare. */
async function importKey(ownerId: number): Promise<string> {
  const token = `pa_${newToken()}`;
  const res = await execute(
    `UPDATE import_devices SET token_hash = ?, token_hint = ?
      WHERE name = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1`,
    [sha256(token), token.slice(-4), DRIVE_DEVICE_NAME],
  );
  if (res.affectedRows === 0) {
    await execute("INSERT INTO import_devices (name, token_hash, token_hint, created_by) VALUES (?, ?, ?, ?)", [
      DRIVE_DEVICE_NAME,
      sha256(token),
      token.slice(-4),
      ownerId,
    ]);
  }
  return token;
}

// ---------------------------------------------------------------------
// Scaricare i file
// ---------------------------------------------------------------------

async function freeBytes(dir: string): Promise<number> {
  const s = await statfs(dir);
  return Number(s.bavail) * Number(s.bsize);
}

async function writeItem(client: DriveClient, item: Item): Promise<void> {
  await mkdir(path.dirname(item.dest), { recursive: true });
  const tmp = `${item.dest}.parziale`;
  for (let attempt = 1; ; attempt++) {
    try {
      let source: Readable;
      if (item.from === "zip") {
        source = await item.zip.openReadStreamPromise(item.entry);
      } else {
        const res = await client.download(item.fileId);
        if (!res.body) throw new Error("risposta vuota");
        source = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
      }
      await pipeline(source, createWriteStream(tmp));
      await rename(tmp, item.dest);
      // Stessa data a ogni ripresa: il programma di import non ricalcola l'impronta.
      if (item.mtime) await utimes(item.dest, item.mtime, item.mtime);
      return;
    } catch (e) {
      await rm(tmp, { force: true });
      if (attempt >= 4) throw new Error(`${path.basename(item.dest)}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function writeAll(client: DriveClient, items: Item[], parallel = 4): Promise<string[]> {
  const failed: string[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      while (next < items.length) {
        const item = items[next++];
        try {
          await writeItem(client, item);
        } catch (e) {
          failed.push((e as Error).message);
        }
      }
    }),
  );
  return failed;
}

// ---------------------------------------------------------------------
// Programma di import
// ---------------------------------------------------------------------

let child: ChildProcess | null = null;

function runImporter(root: string, opts: { takeout: boolean; label: string; key: string }): Promise<void> {
  const tsx = path.resolve("node_modules/.bin/tsx");
  const args = ["scripts/import/index.ts", root, "--etichetta", opts.label.slice(0, 255), "--paralleli", "3"];
  if (opts.takeout) args.push("--takeout");
  return new Promise((resolve, reject) => {
    let tail = "";
    child = spawn(tsx, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        IMPORT_SERVER_URL: env().APP_URL,
        IMPORT_KEY: opts.key,
        PHOTO_ARCHIVE_STATE_DIR: path.join(workDir(), "stato"),
      },
    });
    const keep = (d: Buffer) => {
      tail = (tail + d.toString()).slice(-4000);
    };
    child.stdout!.on("data", keep);
    child.stderr!.on("data", keep);
    child.on("error", reject);
    child.on("close", (code) => {
      child = null;
      // Le righe di avanzamento usano \r: nel log del cron si tiene solo il riepilogo.
      const summary = tail.split(/[\r\n]+/).filter(Boolean).slice(-8).join("\n");
      console.log(summary);
      if (code === 0) resolve();
      else reject(new Error(summary.split("\n").filter((l) => l.includes("✗")).pop()?.replace("✗", "").trim() || `import uscito con codice ${code}`));
    });
  });
}

// ---------------------------------------------------------------------
// Lotti
// ---------------------------------------------------------------------

async function runBatches(
  client: DriveClient,
  job: Job,
  items: Item[],
  root: string,
  takeout: boolean,
  key: string,
  heartbeat: { cancelled: boolean },
) {
  const maxBytes = env().DRIVE_BATCH_GB * 1e9;
  const batches = makeBatches(items, maxBytes);
  const bytes = items.reduce((s, i) => s + i.size, 0);
  await execute(
    "UPDATE drive_imports SET batches_total = ?, files_total = ?, bytes_total = ? WHERE id = ?",
    [batches.length, items.length, bytes, job.id],
  );
  log(`${items.length} foto (${fmtGB(bytes)}) in ${batches.length} lotti; già fatti: ${job.batches_done}`);

  for (let b = job.batches_done; b < batches.length; b++) {
    if (heartbeat.cancelled || (await isCancelled(job))) throw new Cancelled();
    const batch = batches[b];
    const batchBytes = batch.reduce((s, i) => s + i.size, 0);
    const free = await freeBytes(workDir());
    if (free < batchBytes + MARGIN_BYTES) {
      throw new Error(
        `Spazio su disco insufficiente sulla VPS: servono ${fmtGB(batchBytes + MARGIN_BYTES)}, liberi ${fmtGB(free)}. ` +
          "Abbassa DRIVE_BATCH_GB o libera spazio, poi «Riprova».",
      );
    }
    const of = `lotto ${b + 1} di ${batches.length}`;
    await setMessage(job, `Scarico da Drive il ${of} (${fmtGB(batchBytes)})…`);
    log(`Scarico il ${of}: ${batch.length} file, ${fmtGB(batchBytes)}`);
    const failed = await writeAll(client, batch);
    if (failed.length) log(`  ${failed.length} file non scaricati, es.: ${failed[0]}`);
    if (failed.length === batch.length) throw new Error(`Nessun file del ${of} scaricato da Drive: ${failed[0]}`);
    if (heartbeat.cancelled) throw new Cancelled();

    await setMessage(job, `Importo il ${of}…${failed.length ? ` (${failed.length} file non scaricati da Drive)` : ""}`);
    await runImporter(root, { takeout, key, label: `${job.label} · ${of}` });
    // Annullato durante l'import: il programma si è fermato a metà lotto.
    if (heartbeat.cancelled || (await isCancelled(job))) throw new Cancelled();
    for (const item of batch) await rm(item.dest, { force: true });
    await execute("UPDATE drive_imports SET batches_done = ? WHERE id = ?", [b + 1, job.id]);
    job.batches_done = b + 1;
  }
}

function isPhoto(name: string): boolean {
  return !VIDEO_EXT.test(name) && mimeFor(name) !== null;
}

async function runTakeout(client: DriveClient, job: Job, dir: string, key: string, hb: { cancelled: boolean }) {
  const root = path.join(dir, "takeout");
  const zips: yauzl.ZipFile[] = [];
  try {
    const items: Item[] = [];
    let jsons = 0;
    let skipped = 0;
    for (const [i, id] of job.drive_ids.entries()) {
      const meta = await client.file(id);
      await setMessage(job, `Leggo l'indice dello zip ${i + 1} di ${job.drive_ids.length} (${meta.name})…`);
      log(`Zip ${meta.name} (${fmtGB(Number(meta.size))})`);
      const zip = await openDriveZip(client, id, Number(meta.size));
      zips.push(zip);
      const jsonItems: Item[] = [];
      for (const entry of await zipEntries(zip)) {
        const parts = zipEntrySegments(entry.fileName);
        if (!parts) continue;
        const dest = path.join(root, ...parts);
        const name = parts[parts.length - 1];
        const base = { size: entry.uncompressedSize, dest, mtime: entry.getLastModDate(), from: "zip" as const, zip, entry };
        if (name.toLowerCase().endsWith(".json")) jsonItems.push(base);
        else if (isPhoto(name)) items.push(base);
        else skipped++;
      }
      // I JSON (piccoli) subito, tutti: servono a qualunque lotto.
      await setMessage(job, `Estraggo i dati di Google Foto dallo zip ${i + 1} di ${job.drive_ids.length}…`);
      const failed = await writeAll(client, jsonItems, 8);
      if (failed.length) log(`  ${failed.length} JSON non estratti, es.: ${failed[0]}`);
      jsons += jsonItems.length;
      if (hb.cancelled) throw new Cancelled();
    }
    log(`JSON estratti: ${jsons}; video e altri file saltati: ${skipped}`);
    await runBatches(client, job, items, root, true, key, hb);
  } finally {
    for (const z of zips) z.close();
  }
}

async function runFolder(client: DriveClient, job: Job, dir: string, key: string, hb: { cancelled: boolean }) {
  const top = await client.file(job.drive_ids[0]);
  if (top.mimeType !== FOLDER_MIME) throw new Error("Non è una cartella di Drive.");
  const root = path.join(dir, safeSegment(top.name));
  const items: Item[] = [];
  let skipped = 0;
  const queue: { id: string; local: string }[] = [{ id: top.id, local: root }];
  while (queue.length) {
    const folder = queue.shift()!;
    await setMessage(job, `Elenco i file su Drive: ${path.relative(dir, folder.local)}…`);
    const taken = new Set<string>();
    for (const f of await client.list(`${driveQuote(folder.id)} in parents and trashed = false`)) {
      const local = path.join(folder.local, uniqueName(safeSegment(f.name), taken));
      if (f.mimeType === FOLDER_MIME) queue.push({ id: f.id, local });
      else if (!f.mimeType.startsWith("application/vnd.google-apps") && f.size && isPhoto(f.name)) {
        items.push({
          size: Number(f.size),
          dest: local,
          mtime: f.modifiedTime ? new Date(f.modifiedTime) : null,
          from: "drive",
          fileId: f.id,
        });
      } else skipped++;
    }
    if (hb.cancelled) throw new Cancelled();
  }
  log(`Cartella «${top.name}»: video e altri file saltati: ${skipped}`);
  await runBatches(client, job, items, root, false, key, hb);
}

// ---------------------------------------------------------------------
// Giro
// ---------------------------------------------------------------------

async function runJob(client: DriveClient, job: Job) {
  log(`Inizio «${job.label}» (${job.kind})`);
  const dir = path.join(workDir(), job.public_id);
  const hb = { cancelled: false };
  const ticker = setInterval(() => {
    void (async () => {
      await execute("UPDATE drive_imports SET heartbeat_at = UTC_TIMESTAMP() WHERE id = ?", [job.id]);
      if (await isCancelled(job)) {
        hb.cancelled = true;
        child?.kill("SIGINT"); // il programma di import si ferma dopo i file in corso
      }
    })().catch(() => {});
  }, 15_000);

  try {
    const key = await importKey(job.created_by);
    if (job.kind === "takeout") await runTakeout(client, job, dir, key, hb);
    else await runFolder(client, job, dir, key, hb);
    await execute(
      `UPDATE drive_imports SET status = 'finished', finished_at = UTC_TIMESTAMP(), message = NULL
        WHERE id = ? AND status = 'running'`,
      [job.id],
    );
    log(`Finito «${job.label}»`);
  } catch (e) {
    if (e instanceof Cancelled || hb.cancelled) {
      log(`Annullato «${job.label}»`);
    } else {
      const msg = (e as Error).message || String(e);
      log(`Errore in «${job.label}»: ${msg}`);
      await execute(
        `UPDATE drive_imports SET status = 'failed', finished_at = UTC_TIMESTAMP(), message = ?
          WHERE id = ? AND status = 'running'`,
        [msg.slice(0, 1024), job.id],
      );
    }
  } finally {
    clearInterval(ticker);
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  await mkdir(workDir(), { recursive: true });
  const release = await takeLock();
  if (!release) {
    log("Un altro giro è ancora in corso: esco.");
    return;
  }
  process.on("SIGTERM", () => {
    child?.kill("SIGINT");
    void release().then(() => process.exit(143));
  });
  try {
    // Abbiamo il blocco: un import "in corso" è rimasto da un giro morto e si riprende.
    await execute("UPDATE drive_imports SET status = 'queued' WHERE status = 'running'");
    for (;;) {
      const job = await queryOne<Job>(
        `SELECT id, public_id, kind, label, drive_ids, batches_done, created_by
           FROM drive_imports WHERE status = 'queued' ORDER BY created_at, id LIMIT 1`,
      );
      if (!job) break;
      const client = await DriveClient.forOwner();
      if (!client) {
        await execute(
          "UPDATE drive_imports SET status = 'failed', finished_at = UTC_TIMESTAMP(), message = ? WHERE id = ?",
          ["Google Drive non è collegato: collegalo dalla pagina Import → Google Drive, poi «Riprova».", job.id],
        );
        continue;
      }
      await execute(
        `UPDATE drive_imports SET status = 'running', started_at = COALESCE(started_at, UTC_TIMESTAMP()),
                heartbeat_at = UTC_TIMESTAMP(), message = 'Avvio…' WHERE id = ?`,
        [job.id],
      );
      await runJob(client, job);
    }
  } finally {
    await release();
    await pool().end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
