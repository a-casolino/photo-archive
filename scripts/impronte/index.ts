/**
 * Impronte visive: collega al CR2 gli export senza nome né dati della
 * fotocamera confrontando le immagini (richiesta di Antonio del 2026-11-16).
 * Gira sulla VPS a bassa priorità; legge solo le miniature dal bucket.
 *
 *   npm run impronte                    calcola le impronte mancanti e collega
 *   npm run impronte -- --max 500       al massimo 500 impronte in questo giro
 *   npm run impronte -- --prova         calcola, ma per i collegamenti dice solo quanti sarebbero
 *   npm run impronte -- --rifai         ricalcola anche le impronte non riuscite
 *   npm run impronte -- --file a.jpg --file b.jpg
 *                                       stampa le impronte e la distanza, senza database
 *
 * I collegamenti trovati finiscono in Collegamenti → Da confermare
 * (match_method = 'pixel'). Le regole stanno in src/lib/phash-rules.ts.
 */
import "../load-env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { execute, pool, query } from "../../src/lib/db";
import {
  dHashHex,
  hamming,
  HASH_HEIGHT,
  HASH_WIDTH,
  matchByPixels,
  parseHash,
  pathStem,
  type HashedPhoto,
} from "../../src/lib/phash-rules";
import { storage } from "../../src/lib/storage";
import { runLimited } from "../../src/lib/trash-rules";

const BATCH = 200;
const PARALLEL = 4;

function options() {
  const { values } = parseArgs({
    options: {
      max: { type: "string" },
      prova: { type: "boolean", default: false },
      rifai: { type: "boolean", default: false },
      file: { type: "string", multiple: true },
    },
  });
  return {
    max: values.max ? Number(values.max) : Infinity,
    dryRun: values.prova,
    redo: values.rifai,
    files: values.file ?? [],
  };
}

async function hashImage(image: Buffer): Promise<string> {
  const data = await sharp(image, { failOn: "none" })
    .grayscale()
    .resize(HASH_WIDTH, HASH_HEIGHT, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();
  return dHashHex(data);
}

async function tryFiles(files: string[]) {
  const hashes: { name: string; hex: string }[] = [];
  for (const f of files) {
    const hex = await hashImage(await readFile(f));
    hashes.push({ name: path.basename(f), hex });
    console.log(`${path.basename(f)}: ${hex}`);
  }
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      const d = hamming(parseHash(hashes[i].hex), parseHash(hashes[j].hex));
      console.log(`  ${hashes[i].name} ~ ${hashes[j].name}: ${d} bit diversi su 64`);
    }
  }
}

/** Calcola le impronte mancanti, a lotti, poche miniature alla volta. */
async function hashArchive(opts: ReturnType<typeof options>): Promise<void> {
  const pending = `deleted_at IS NULL AND gcs_thumb_key IS NOT NULL AND (phash IS NULL${opts.redo ? " OR phash = ''" : ""})`;
  const [{ n: total }] = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM photos WHERE ${pending}`);
  const todo = Math.min(Number(total), opts.max);
  console.log(`[impronte] Foto senza impronta: ${total}${todo < Number(total) ? ` (ne faccio ${todo})` : ""}.`);
  let done = 0, failed = 0, lastId = 0;
  const started = performance.now();
  while (done + failed < todo) {
    const batch = await query<{ id: number; key: string }>(
      `SELECT id, gcs_thumb_key AS \`key\` FROM photos WHERE ${pending} AND id > ? ORDER BY id LIMIT ?`,
      [lastId, Math.min(BATCH, todo - done - failed)],
    );
    if (!batch.length) break;
    lastId = Number(batch[batch.length - 1].id);
    const results: { id: number; hex: string }[] = [];
    const errors = await runLimited(batch, PARALLEL, async (p) => {
      results.push({ id: p.id, hex: await hashImage(await storage().read(p.key)) });
    });
    for (const { item, error } of errors) {
      console.warn(`[impronte] foto ${item.id}: ${error instanceof Error ? error.message : error}`);
      results.push({ id: item.id, hex: "" });
    }
    if (results.length) {
      await execute(
        `UPDATE photos p JOIN (${results.map(() => "SELECT ? AS id, ? AS h").join(" UNION ALL ")}) v ON v.id = p.id
            SET p.phash = v.h`,
        results.flatMap((r) => [r.id, r.hex]),
      );
    }
    done += batch.length - errors.length;
    failed += errors.length;
    const s = (performance.now() - started) / 1000;
    console.log(`[impronte] ${done + failed}/${todo} (${failed} non riuscite, ${(s / (done + failed) * 1000).toFixed(0)} ms a foto)`);
  }
}

/** Collega gli export ancora senza CR2 al CR2 con l'immagine quasi uguale. */
async function linkByPixels(dryRun: boolean): Promise<void> {
  const [rows, raws] = await Promise.all([
    query<{ id: number; phash: string; taken_at: Date | null; source_path: string | null }>(
      `SELECT id, phash, taken_at, source_path FROM photos
        WHERE kind IN ('edit', 'phone') AND match_status = 'none' AND derived_from_id IS NULL
          AND deleted_at IS NULL AND phash IS NOT NULL AND phash <> ''`,
    ),
    query<{ id: number; phash: string; taken_at: Date | null; source_path: string | null }>(
      `SELECT id, phash, taken_at, source_path FROM photos
        WHERE kind = 'raw' AND deleted_at IS NULL AND phash IS NOT NULL AND phash <> ''`,
    ),
  ]);
  // Il JPEG che la fotocamera salva accanto al CR2 (RAW+JPEG) non è un export.
  const rawStems = new Set(raws.flatMap((r) => (r.source_path ? [pathStem(r.source_path)] : [])));
  const exports: HashedPhoto[] = rows
    .filter((e) => !(e.source_path && rawStems.has(pathStem(e.source_path))))
    .map((e) => ({ id: e.id, hash: parseHash(e.phash), taken: e.taken_at }));
  const rawHashes: HashedPhoto[] = raws.map((r) => ({ id: r.id, hash: parseHash(r.phash), taken: r.taken_at }));

  const t = performance.now();
  const { auto, ambiguous } = matchByPixels(exports, rawHashes);
  const s = ((performance.now() - t) / 1000).toFixed(1);
  const hist = new Map<number, number>();
  for (const m of auto) hist.set(m.distance, (hist.get(m.distance) ?? 0) + 1);
  console.log(
    `[impronte] ${exports.length} export senza CR2 confrontati con ${rawHashes.length} CR2 in ${s} s: ` +
      `${auto.length} collegabili, ${ambiguous} con più CR2 quasi uguali (raffiche, restano da fare a mano).`,
  );
  console.log(
    `[impronte] bit diversi dei collegabili: ${[...hist].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}→${v}`).join(", ") || "nessuno"}`,
  );
  if (dryRun || !auto.length) return;

  let linked = 0;
  for (let i = 0; i < auto.length; i += 500) {
    const chunk = auto.slice(i, i + 500);
    const res = await execute(
      `UPDATE photos p JOIN (${chunk.map(() => "SELECT ? AS eid, ? AS rid").join(" UNION ALL ")}) m ON m.eid = p.id
          SET p.kind = 'edit', p.derived_from_id = m.rid, p.match_status = 'auto', p.match_method = 'pixel'
        WHERE p.match_status = 'none' AND p.derived_from_id IS NULL AND p.deleted_at IS NULL`,
      chunk.flatMap((m) => [m.exportId, m.rawId]),
    );
    linked += res.affectedRows;
  }
  console.log(`[impronte] ${linked} collegamenti da confermare in Collegamenti.`);
}

async function main() {
  const opts = options();
  if (opts.files.length) return tryFiles(opts.files);
  await hashArchive(opts);
  await linkByPixels(opts.dryRun);
  await pool().end();
}

main()
  .catch(async (e) => {
    console.error("[impronte]", e instanceof Error ? e.message : e);
    await pool()
      .end()
      .catch(() => {});
    process.exit(1);
  });
