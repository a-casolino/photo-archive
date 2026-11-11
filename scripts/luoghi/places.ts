import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { execute, query } from "../../src/lib/db";
import { env } from "../../src/lib/env";
import {
  parseAdmin1,
  parseCities,
  parseItalianNames,
  parsePlaces,
  PlaceIndex,
  serializePlaces,
} from "../../src/lib/place-rules";
import { zipEntries, zipExtract } from "../volti/models";

/*
 * Elenco delle località (GeoNames) e calcolo di photos.place_name.
 * Usato da `npm run luoghi` e alla fine di ogni giro di `npm run drive`.
 */

const GEONAMES = "https://download.geonames.org/export/dump";
/** File da scaricare: nome locale → URL. Licenza CC BY 4.0 (geonames.org). */
export const SOURCES = {
  "cities500.zip": `${GEONAMES}/cities500.zip`,
  "admin1CodesASCII.txt": `${GEONAMES}/admin1CodesASCII.txt`,
  "IT.zip": `${GEONAMES}/alternatenames/IT.zip`,
} as const;
const COMPACT = "luoghi.tsv";

const dataDir = () => path.resolve(env().PLACES_DATA_DIR);

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

async function download(url: string): Promise<Buffer> {
  console.log(`[luoghi] scarico ${url} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download non riuscito (${url}): HTTP ${res.status}.`);
  return Buffer.from(await res.arrayBuffer());
}

/** Il file di testo `name` dentro lo zip. */
function unzipText(zip: Buffer, name: string): string {
  const entry = zipEntries(zip).find((e) => path.posix.basename(e.name) === name);
  if (!entry) throw new Error(`${name} non è nello zip.`);
  return zipExtract(zip, entry).toString("utf8");
}

/**
 * Prepara `luoghi.tsv`. Usa i file già presenti nella cartella (per esempio
 * copiati a mano) e scarica solo quelli che mancano; con `force` li riscarica.
 */
export async function preparePlaces({ force = false } = {}): Promise<string> {
  const dir = dataDir();
  await mkdir(dir, { recursive: true });
  const raw: Record<string, Buffer> = {};
  for (const [name, url] of Object.entries(SOURCES)) {
    const file = path.join(dir, name);
    if (!force && (await exists(file))) {
      raw[name] = await readFile(file);
    } else {
      raw[name] = await download(url);
      await writeFile(file, raw[name]);
    }
  }
  const admin1 = parseAdmin1(raw["admin1CodesASCII.txt"].toString("utf8"));
  const italian = parseItalianNames(unzipText(raw["IT.zip"], "IT.txt"));
  const places = parseCities(unzipText(raw["cities500.zip"], "cities500.txt"), admin1, italian);
  if (places.length < 1000) throw new Error(`Elenco delle località sospetto: solo ${places.length} righe.`);
  const out = path.join(dir, COMPACT);
  await writeFile(`${out}.tmp`, serializePlaces(places));
  await rename(`${out}.tmp`, out);
  console.log(`[luoghi] ${places.length} località pronte in ${out}.`);
  return out;
}

let cached: PlaceIndex | null = null;

/** L'indice delle località; lo prepara (scaricando i file) la prima volta. */
export async function loadPlaceIndex(): Promise<PlaceIndex> {
  if (cached) return cached;
  const file = path.join(dataDir(), COMPACT);
  if (!(await exists(file))) await preparePlaces();
  cached = new PlaceIndex(parsePlaces(await readFile(file, "utf8")));
  return cached;
}

type Row = { id: number; gps_lat: string; gps_lon: string };

/**
 * Dà un nome al luogo delle foto con il GPS che non l'hanno ancora
 * (`all`: anche a quelle che l'hanno già, per esempio dopo un aggiornamento
 * dell'elenco). Restituisce quante foto ha aggiornato.
 */
export async function fillPlaceNames({ all = false } = {}): Promise<{ named: number; empty: number }> {
  const pendingSql = `SELECT id, gps_lat, gps_lon FROM photos
     WHERE gps_lat IS NOT NULL AND gps_lon IS NOT NULL AND place_name IS NULL AND id > ?
     ORDER BY id LIMIT 1000`;
  if (all) await execute("UPDATE photos SET place_name = NULL WHERE place_name IS NOT NULL");
  let rows = await query<Row>(pendingSql, [0]);
  if (!rows.length) return { named: 0, empty: 0 };
  const index = await loadPlaceIndex();
  let named = 0;
  let empty = 0;
  while (rows.length) {
    // Raggruppa per nome: un UPDATE per luogo invece di uno per foto.
    const byName = new Map<string, number[]>();
    for (const r of rows) {
      const name = index.nearest(Number(r.gps_lat), Number(r.gps_lon))?.label ?? "";
      if (name) named++;
      else empty++;
      const ids = byName.get(name);
      if (ids) ids.push(r.id);
      else byName.set(name, [r.id]);
    }
    for (const [name, ids] of byName) {
      await execute("UPDATE photos SET place_name = ? WHERE id IN (?)", [name, ids]);
    }
    rows = await query<Row>(pendingSql, [rows[rows.length - 1].id]);
  }
  return { named, empty };
}
