/**
 * Volti: trova i volti nelle anteprime delle foto e ne calcola l'impronta.
 * Gira sulla VPS, a bassa priorità e con pochi thread, ogni tanto.
 *
 *   npm run volti                        analizza le foto non ancora analizzate
 *   npm run volti -- --max 200           al massimo 200 foto (per misurare i carichi)
 *   npm run volti -- --pausa 300         pausa (ms) tra una foto e l'altra
 *   npm run volti -- --rifai             rianalizza anche quelle già fatte
 *                                        (i volti ritrovati nello stesso punto tengono il nome)
 *   npm run volti -- --scarica-modelli   scarica i modelli InsightFace in FACES_MODEL_DIR
 *                    [--zip buffalo_l.zip]  oppure li prende da uno zip già scaricato
 *   npm run volti -- --file a.jpg --file b.jpg
 *                                        prova su file locali, senza database: salva le
 *                                        immagini con i riquadri in ./prova-volti e
 *                                        stampa quanto si somigliano i volti trovati
 *
 * Configurazione (.env): FACES_MODEL_DIR, FACES_THREADS, FACES_DET_SIZE,
 * FACES_MIN_SIZE, più database e archivio come il sito.
 */
import "../load-env";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { pool, query } from "../../src/lib/db";
import { encodeEmbedding, similarity } from "../../src/lib/faces/embedding";
import { createFaceEngine, FACE_MODEL_ID, type AnalyzedImage, type FaceEngine } from "../../src/lib/faces/engine";
import { thumbnailRegion } from "../../src/lib/faces/geometry";
import { faceThumbKey, landmarkFractions, matchPrevious, toFractions } from "../../src/lib/faces/records";
import { env } from "../../src/lib/env";
import { storage } from "../../src/lib/storage";
import { downloadModels } from "./models";

const FACE_THUMB_SIZE = 160;

function options() {
  const { values } = parseArgs({
    options: {
      max: { type: "string" },
      pausa: { type: "string" },
      rifai: { type: "boolean", default: false },
      "scarica-modelli": { type: "boolean", default: false },
      zip: { type: "string" },
      file: { type: "string", multiple: true },
    },
  });
  return {
    max: values.max ? Number(values.max) : Infinity,
    pause: values.pausa ? Number(values.pausa) : 0,
    redo: values.rifai,
    download: values["scarica-modelli"],
    zip: values.zip,
    files: values.file ?? [],
  };
}

/** Variabili dei volti senza toccare quelle del database (per --file). */
function faceSettings() {
  const e = process.env;
  return {
    modelDir: e.FACES_MODEL_DIR || "./modelli-volti",
    threads: Number(e.FACES_THREADS || 2),
    detSize: Number(e.FACES_DET_SIZE || 640),
    minSize: Number(e.FACES_MIN_SIZE || 40),
    minScore: 0.5,
  };
}

async function faceThumb(image: Buffer, analyzed: AnalyzedImage, index: number): Promise<Buffer> {
  const region = thumbnailRegion(analyzed.faces[index].box, analyzed.width, analyzed.height);
  return sharp(image)
    .rotate()
    .extract(region)
    .resize(FACE_THUMB_SIZE, FACE_THUMB_SIZE)
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

// ---------------------------------------------------------------------
// Prova su file locali
// ---------------------------------------------------------------------

async function tryFiles(engine: FaceEngine, files: string[]) {
  const outDir = path.resolve("prova-volti");
  await mkdir(outDir, { recursive: true });
  const all: { label: string; embedding: Float32Array }[] = [];
  for (const file of files) {
    const image = await readFile(file);
    const t0 = performance.now();
    const res = await engine.analyze(image);
    const ms = Math.round(performance.now() - t0);
    const name = path.parse(file).name;
    console.log(`${path.basename(file)}: ${res.faces.length} volti in ${ms} ms`);
    const rects = res.faces
      .map((f, i) => {
        const { x1, y1, x2, y2 } = f.box;
        const stroke = Math.max(2, Math.round(res.width / 400));
        return `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="none" stroke="#ffd400" stroke-width="${stroke}"/>
          <text x="${x1}" y="${Math.max(y1 - 6, 20)}" font-size="${stroke * 10}" font-family="sans-serif" fill="#ffd400">${i + 1}</text>`;
      })
      .join("");
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${res.width}" height="${res.height}">${rects}</svg>`);
    await sharp(image).rotate().composite([{ input: svg }]).jpeg({ quality: 85 }).toFile(path.join(outDir, `${name}.volti.jpg`));
    for (let i = 0; i < res.faces.length; i++) {
      const f = res.faces[i];
      console.log(`  volto ${i + 1}: ${Math.round(f.box.x2 - f.box.x1)}×${Math.round(f.box.y2 - f.box.y1)} px, punteggio ${f.score.toFixed(2)}`);
      await sharp(await faceThumb(image, res, i)).toFile(path.join(outDir, `${name}.volto${i + 1}.jpg`));
      all.push({ label: `${name}#${i + 1}`, embedding: f.embedding });
    }
  }
  if (all.length > 1) {
    console.log("\nSomiglianza tra i volti (oltre 0,4 di solito è la stessa persona):");
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        console.log(`  ${all[i].label} ~ ${all[j].label}: ${similarity(all[i].embedding, all[j].embedding).toFixed(2)}`);
      }
    }
  }
  console.log(`\nImmagini con i riquadri e ritagli dei volti in ${outDir}`);
}

// ---------------------------------------------------------------------
// Analisi dell'archivio
// ---------------------------------------------------------------------

interface PhotoRow {
  id: number;
  sha256: string;
  original_filename: string;
  gcs_preview_key: string;
}

interface FaceRow extends RowDataPacket {
  id: number;
  box_x: number;
  box_y: number;
  box_w: number;
  box_h: number;
  status: "unknown" | "suggested" | "confirmed" | "ignored";
}

async function savePhoto(conn: PoolConnection, photo: PhotoRow, image: Buffer, res: AnalyzedImage) {
  const [previous] = await conn.query<FaceRow[]>(
    "SELECT id, box_x, box_y, box_w, box_h, status FROM faces WHERE photo_id = ?",
    [photo.id],
  );
  const boxes = res.faces.map((f) => toFractions(f.box, res.width, res.height));
  const match = matchPrevious(
    previous.map((p) => ({ x: p.box_x, y: p.box_y, w: p.box_w, h: p.box_h })),
    boxes,
  );

  // Prima le miniature: se il caricamento fallisce il DB resta com'era.
  const keys: string[] = [];
  for (let i = 0; i < res.faces.length; i++) {
    const key = faceThumbKey(photo.sha256, i);
    await storage().write(key, await faceThumb(image, res, i), "image/jpeg", "STANDARD");
    keys.push(key);
  }

  await conn.beginTransaction();
  try {
    const kept = new Set<number>();
    for (let i = 0; i < res.faces.length; i++) {
      const f = res.faces[i];
      const b = boxes[i];
      const values = [
        b.x, b.y, b.w, b.h,
        JSON.stringify(landmarkFractions(f, res.width, res.height)),
        f.score,
        encodeEmbedding(f.embedding),
        FACE_MODEL_ID,
        keys[i],
      ];
      const old = match[i] >= 0 ? previous[match[i]] : null;
      if (old) {
        // Stesso volto di prima: tiene id, nome confermato, scarti e copertine.
        // Un suggerimento però va ricalcolato con la nuova impronta.
        kept.add(old.id);
        await conn.query(
          `UPDATE faces SET box_x = ?, box_y = ?, box_w = ?, box_h = ?, landmarks = ?, det_score = ?,
                  embedding = ?, model = ?, gcs_face_key = ?, cluster_id = NULL,
                  status = IF(status = 'suggested', 'unknown', status),
                  person_id = IF(status = 'unknown', NULL, person_id),
                  suggest_score = NULL
            WHERE id = ?`,
          [...values, old.id],
        );
      } else {
        await conn.query(
          `INSERT INTO faces (photo_id, box_x, box_y, box_w, box_h, landmarks, det_score, embedding, model, gcs_face_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [photo.id, ...values],
        );
      }
    }
    const gone = previous.filter((p) => !kept.has(p.id)).map((p) => p.id);
    if (gone.length) await conn.query("DELETE FROM faces WHERE id IN (?)", [gone]);
    await conn.query("UPDATE photos SET faces_scanned_at = UTC_TIMESTAMP(), faces_model = ? WHERE id = ?", [
      FACE_MODEL_ID,
      photo.id,
    ]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

async function scanArchive(engine: FaceEngine, opts: ReturnType<typeof options>) {
  const pending = `deleted_at IS NULL AND gcs_preview_key IS NOT NULL${opts.redo ? "" : " AND (faces_model IS NULL OR faces_model <> ?)"}`;
  const params = opts.redo ? [] : [FACE_MODEL_ID];
  const [{ n: total }] = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM photos WHERE ${pending}`, params);
  const todo = Math.min(total, opts.max);
  console.log(`Foto da analizzare: ${total}${todo < total ? ` (ne faccio ${todo})` : ""}.`);
  if (!todo) return;

  let stop = false;
  process.on("SIGINT", () => {
    if (stop) process.exit(130);
    stop = true;
    console.log("\nMi fermo dopo la foto in corso (Ctrl+C di nuovo per uscire subito).");
  });

  const conn = await pool().getConnection();
  const started = performance.now();
  let done = 0, faces = 0, errors = 0, lastId = 0, peakRss = 0, busyMs = 0;
  try {
    while (!stop && done + errors < todo) {
      const batch = await query<PhotoRow>(
        `SELECT id, sha256, original_filename, gcs_preview_key FROM photos
          WHERE ${pending} AND id > ? ORDER BY id LIMIT 50`,
        [...params, lastId],
      );
      if (!batch.length) break;
      for (const photo of batch) {
        if (stop || done + errors >= todo) break;
        lastId = photo.id;
        const t0 = performance.now();
        try {
          const image = await storage().read(photo.gcs_preview_key);
          const res = await engine.analyze(image);
          await savePhoto(conn, photo, image, res);
          done++;
          faces += res.faces.length;
          const ms = performance.now() - t0;
          busyMs += ms;
          console.log(`[${done + errors}/${todo}] ${photo.original_filename}: ${res.faces.length} volti (${Math.round(ms)} ms)`);
        } catch (e) {
          errors++;
          console.error(`[${done + errors}/${todo}] ${photo.original_filename}: errore, ${(e as Error).message}`);
        }
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
        if (opts.pause) await new Promise((r) => setTimeout(r, opts.pause));
      }
    }
  } finally {
    conn.release();
  }
  const secs = (performance.now() - started) / 1000;
  console.log(
    `\nFatto: ${done} foto, ${faces} volti, ${errors} errori in ${Math.round(secs)} s ` +
      `(media ${done ? Math.round(busyMs / done) : 0} ms per foto, memoria massima ${Math.round(peakRss / 1e6)} MB).`,
  );
  if (stop) console.log("Interrotto: rilanciando riprende dalle foto mancanti.");
}

async function main() {
  const opts = options();
  const settings = faceSettings();
  if (opts.download) {
    await downloadModels(settings.modelDir, opts.zip);
    return;
  }
  // Bassa priorità: i siti sulla stessa VPS hanno la precedenza.
  try {
    os.setPriority(19);
  } catch {
    // su alcuni sistemi non si può: si va avanti lo stesso
  }
  if (!opts.files.length) {
    // Valida tutta la configurazione (database, archivio, volti) prima di caricare i modelli.
    const e = env();
    Object.assign(settings, {
      modelDir: e.FACES_MODEL_DIR,
      threads: e.FACES_THREADS,
      detSize: e.FACES_DET_SIZE,
      minSize: e.FACES_MIN_SIZE,
    });
  }
  console.log(
    `Modello ${FACE_MODEL_ID}, ${settings.threads} thread, rilevatore ${settings.detSize} px, volti da ${settings.minSize} px.`,
  );
  const engine = await createFaceEngine(settings);
  try {
    if (opts.files.length) await tryFiles(engine, opts.files);
    else await scanArchive(engine, opts);
  } finally {
    await engine.release();
    if (!opts.files.length) await pool().end();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
