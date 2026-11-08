/**
 * Cestino delle foto: eliminazione definitiva automatica.
 * Pensato per un cron sulla VPS (per esempio una volta al giorno).
 *
 *   npm run cestino                 elimina le foto nel cestino da più di
 *                                   TRASH_RETENTION_DAYS giorni (30)
 *   npm run cestino -- --giorni 60  con un'altra soglia
 *
 * Cancella i file dall'archivio (CR2, anteprime, miniature dei volti) e poi
 * le righe nel database, come "Elimina definitivamente" nella pagina Cestino.
 */
import "./load-env";
import { parseArgs } from "node:util";
import { pool } from "../src/lib/db";
import { env } from "../src/lib/env";
import { purgePhotos } from "../src/lib/trash";

async function main() {
  const { values } = parseArgs({ options: { giorni: { type: "string" } } });
  const days = values.giorni ? Number(values.giorni) : env().TRASH_RETENTION_DAYS;
  if (!Number.isInteger(days) || days < 1) throw new Error("--giorni deve essere un numero intero da 1 in su.");
  const { deleted, failed } = await purgePhotos({ olderThanDays: days });
  console.log(`[cestino] nel cestino da più di ${days} giorni: ${deleted} eliminate, ${failed} non riuscite.`);
  await pool().end();
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[cestino]", e instanceof Error ? e.message : e);
  process.exit(1);
});
