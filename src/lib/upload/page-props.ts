import "server-only";
import { queryOne } from "../db";
import { storage } from "../storage";

/*
 * Dati del server per il caricamento dal browser, uguali per la pagina
 * "Carica dal browser" e per la pagina dell'album.
 */

/** Versione di ExifTool (WebAssembly): fa parte dell'URL, così il browser la tiene in cache. */
export const EXIFTOOL_WASM_URL = "/api/import/exiftool?v=13.42-1";

export async function uploaderProps(): Promise<{
  wasmUrl: string;
  recentBps: number | null;
  testStorage: boolean;
  today: string;
}> {
  // Velocità di caricamento degli ultimi import grandi, per la stima del riepilogo.
  const speed = await queryOne<{ bytes: number; seconds: number }>(
    `SELECT COALESCE(SUM(bytes_uploaded), 0) AS bytes,
            COALESCE(SUM(TIMESTAMPDIFF(SECOND, started_at, COALESCE(finished_at, last_seen_at))), 0) AS seconds
       FROM (SELECT bytes_uploaded, started_at, finished_at, last_seen_at FROM imports
              WHERE bytes_uploaded > 50000000 ORDER BY started_at DESC LIMIT 5) x`,
  );
  return {
    wasmUrl: EXIFTOOL_WASM_URL,
    recentBps: Number(speed?.seconds) > 60 ? Number(speed?.bytes) / Number(speed?.seconds) : null,
    testStorage: storage().driver !== "gcs",
    today: new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long", year: "numeric" }).format(
      new Date(),
    ),
  };
}
