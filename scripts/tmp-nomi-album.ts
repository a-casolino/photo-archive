// Script temporaneo (thread "Dare un nome agli album con solo la data"): sola lettura.
import "./load-env";
import { query, pool } from "../src/lib/db";
import { storage } from "../src/lib/storage";
import { gzipSync } from "node:zlib";

const mode = process.argv[2] ?? "elenco";

function isDateOnly(t: string): boolean {
  const rest = t
    .replace(/\(foto senza cartella\)/i, "")
    .replace(/\d{4}([-_. ]\d{1,2}){0,2}/g, "")
    .replace(/[\s\-_.,/()]+/g, "");
  return rest.length === 0;
}

async function main() {
  const albums = await query<{ id: number; public_id: string; title: string; origin: string; origin_ref: string | null; date_from: string | null; date_to: string | null; n: number; extra: number }>(
    `SELECT a.id, a.public_id, a.title, a.origin, a.origin_ref, a.date_from, a.date_to,
            (SELECT COUNT(*) FROM album_photos ap WHERE ap.album_id = a.id) AS n,
            (SELECT COUNT(*) FROM album_photos ap WHERE ap.album_id = a.id AND ap.section = 'extra') AS extra
       FROM albums a WHERE a.deleted_at IS NULL AND a.parent_id IS NULL ORDER BY a.title`,
  );
  if (mode === "elenco") {
    for (const a of albums) console.log(`${isDateOnly(a.title) ? "*" : " "} ${a.id}\t${a.origin}\t${a.n}\t${a.title}`);
    return;
  }
  const ids = mode.startsWith("dettagli") ? albums.filter((a) => isDateOnly(a.title)).map((a) => a.id).slice(Number(mode.split(":")[1] ?? 0), Number(mode.split(":")[1] ?? 0) + Number(mode.split(":")[2] ?? 999)) : mode.split(",").map(Number);
  const per = Number(process.argv[3] ?? 8);
  const out: unknown[] = [];
  for (const id of ids) {
    const a = albums.find((x) => x.id === id)!;
    const subs = await query<{ title: string }>(`SELECT title FROM albums WHERE parent_id = ? AND deleted_at IS NULL`, [id]);
    const places = await query<{ place_name: string; c: number }>(
      `SELECT p.place_name, COUNT(*) c FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
        WHERE ap.album_id = ? AND p.place_name <> '' GROUP BY p.place_name ORDER BY c DESC LIMIT 4`, [id]);
    const people = await query<{ name: string; c: number }>(
      `SELECT pe.name, COUNT(DISTINCT f.photo_id) c FROM album_photos ap JOIN faces f ON f.photo_id = ap.photo_id
         JOIN people pe ON pe.id = f.person_id
        WHERE ap.album_id = ? AND f.status IN ('confirmed','suggested') GROUP BY pe.name ORDER BY c DESC LIMIT 6`, [id]);
    const tags = await query<{ name: string }>(
      `SELECT DISTINCT t.name FROM album_photos ap JOIN photo_tags pt ON pt.photo_id = ap.photo_id JOIN tags t ON t.id = pt.tag_id
        WHERE ap.album_id = ? LIMIT 8`, [id]);
    const files = await query<{ original_filename: string; source_path: string | null; taken_at: string | null; gcs_thumb_key: string | null; model: string | null }>(
      `SELECT p.original_filename, p.source_path, p.taken_at, p.gcs_thumb_key, c.model
         FROM album_photos ap JOIN photos p ON p.id = ap.photo_id LEFT JOIN cameras c ON c.id = p.camera_id
        WHERE ap.album_id = ? AND p.deleted_at IS NULL ORDER BY ap.section, p.taken_at`, [id]);
    const step = Math.max(1, Math.floor(files.length / per));
    const sample = files.filter((_, i) => i % step === 0).slice(0, per);
    const thumbs = per > 0 ? await Promise.all(sample.filter((f) => f.gcs_thumb_key).map((f) => storage().readUrl(f.gcs_thumb_key!, 6 * 3600))) : [];
    const cams = [...new Set(files.map((f) => f.model ?? "?"))].slice(0, 4);
    out.push({ id, public_id: a.public_id, title: a.title, origin_ref: a.origin_ref, n: a.n, extra: a.extra, from: a.date_from, to: a.date_to,
      subs: subs.map((s) => s.title), places, people, tags: tags.map((t) => t.name), cams,
      files: sample.map((f) => `${f.source_path ?? f.original_filename} ${f.taken_at ? new Date(f.taken_at).toISOString().slice(0, 16) : ""}`), thumbs });
  }
  const b64 = gzipSync(JSON.stringify(out)).toString("base64url");
  console.log(b64 + "~" + ".".repeat(Math.max(0, 54800 - b64.length)));
}

main().then(() => pool().end()).catch((e) => { console.error(e); process.exit(1); });
