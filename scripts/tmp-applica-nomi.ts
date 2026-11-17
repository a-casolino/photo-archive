// Script temporaneo (thread "Dare un nome agli album con solo la data").
// Senza argomenti: PROVA, non scrive nulla. Con "applica": rinomina e unisce gli album del piano.
import "./load-env";
import { readFileSync } from "node:fs";
import { query, pool } from "../src/lib/db";
import { mergeAlbums } from "../src/lib/albums";

type Piano = {
  renames: { id: number; pid: string; old: string; title: string }[];
  merges: { into: number; from: number[]; title: string; pid: string; fromPid: string[]; old: Record<string, string> }[];
};
const piano = JSON.parse(readFileSync(new URL("./tmp-nomi-album-piano.json", import.meta.url), "utf8")) as Piano;
const applica = process.argv[2] === "applica";

async function stato(ids: number[]) {
  const rows = await query<{ id: number; title: string; deleted_at: Date | null }>(
    `SELECT id, title, deleted_at FROM albums WHERE id IN (?)`, [ids]);
  return new Map(rows.map((r) => [r.id, r]));
}

async function main() {
  console.log(applica ? "APPLICA" : "PROVA (nessuna scrittura)");
  const s = await stato([...piano.renames.map((r) => r.id), ...piano.merges.flatMap((m) => [m.into, ...m.from])]);
  let ok = 0, salt = 0;
  for (const r of piano.renames) {
    const a = s.get(r.id);
    if (!a || a.deleted_at || a.title !== r.old) { console.log(`SALTO ${r.id}: ${a ? (a.deleted_at ? "nel cestino" : `titolo ora «${a.title}»`) : "non esiste"}`); salt++; continue; }
    if (applica) await query(`UPDATE albums SET title = ? WHERE id = ? AND title = ? AND deleted_at IS NULL`, [r.title, r.id, r.old]);
    ok++;
  }
  console.log(`rinomine: ${ok} ok, ${salt} saltate`);
  for (const m of piano.merges) {
    const bad = [m.into, ...m.from].filter((id) => { const a = s.get(id); return !a || a.deleted_at || a.title !== m.old[String(id)]; });
    if (bad.length) { console.log(`SALTO unione ${m.into}: cambiati ${bad.join(",")}`); continue; }
    if (!applica) { console.log(`unirei ${m.from.join("+")} in ${m.into} → «${m.title}»`); continue; }
    const res = await mergeAlbums({ intoPublicId: m.pid, sourcePublicIds: m.fromPid, title: m.title, shares: "move" });
    console.log(`unione ${m.into} → «${m.title}»: ${JSON.stringify(res).slice(0, 200)}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool().end());
