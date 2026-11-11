/**
 * Nome del luogo delle foto, dalle coordinate GPS, senza servizi esterni.
 * Gira sulla VPS; lo stesso lavoro si fa anche alla fine di ogni giro di
 * `npm run drive` (cron ogni 15 minuti), quindi di solito non serve lanciarlo.
 *
 *   npm run luoghi                 dà un nome alle foto con GPS che non l'hanno
 *   npm run luoghi -- --scarica    riscarica l'elenco di GeoNames e lo rifà
 *   npm run luoghi -- --tutte      ricalcola il nome di tutte le foto
 *   npm run luoghi -- --prova 45.4371 12.3326   stampa il luogo, senza database
 *
 * L'elenco delle località (GeoNames, CC BY 4.0) sta in PLACES_DATA_DIR e si
 * scarica da solo la prima volta (~30 MB). Se la VPS non lo raggiunge, copia
 * a mano cities500.zip, admin1CodesASCII.txt e alternatenames/IT.zip in quella
 * cartella.
 */
import "../load-env";
import { parseArgs } from "node:util";
import { pool } from "../../src/lib/db";
import { fillPlaceNames, loadPlaceIndex, preparePlaces } from "./places";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      scarica: { type: "boolean" },
      tutte: { type: "boolean" },
      prova: { type: "boolean" },
    },
  });
  if (values.scarica) await preparePlaces({ force: true });
  if (values.prova) {
    const [lat, lon] = positionals.map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Uso: npm run luoghi -- --prova <lat> <lon>");
    const p = (await loadPlaceIndex()).nearest(lat, lon);
    console.log(p ? `${p.label} (${p.km.toFixed(1)} km)` : "Nessuna località entro 50 km.");
    return;
  }
  const t = Date.now();
  const { named, empty } = await fillPlaceNames({ all: values.tutte });
  console.log(
    `[luoghi] ${named} foto con il nome del luogo, ${empty} senza località vicine (${((Date.now() - t) / 1000).toFixed(1)} s).`,
  );
  await pool().end();
}

main().catch(async (e) => {
  console.error("[luoghi]", e instanceof Error ? e.message : e);
  await pool()
    .end()
    .catch(() => {});
  process.exit(1);
});
