import Link from "next/link";
import { queryOne } from "@/lib/db";
import { requireOwner } from "@/lib/session";
import { storage } from "@/lib/storage";
import { Uploader } from "./uploader";

/*
 * "Carica dal browser": foto e cartelle trascinate o scelte, anche dal
 * telefono. Il lavoro lo fa il browser (src/lib/upload/engine.ts); i file
 * vanno direttamente su Google Cloud, la VPS registra soltanto.
 */

export const metadata = { title: "Carica dal browser" };

/** Versione di ExifTool (WebAssembly): fa parte dell'URL, così il browser la tiene in cache. */
const EXIFTOOL_WASM_URL = "/api/import/exiftool?v=13.42-1";

export default async function UploadPage() {
  await requireOwner();
  // Velocità di caricamento degli ultimi import grandi, per la stima del riepilogo.
  const speed = await queryOne<{ bytes: number; seconds: number }>(
    `SELECT COALESCE(SUM(bytes_uploaded), 0) AS bytes,
            COALESCE(SUM(TIMESTAMPDIFF(SECOND, started_at, COALESCE(finished_at, last_seen_at))), 0) AS seconds
       FROM (SELECT bytes_uploaded, started_at, finished_at, last_seen_at FROM imports
              WHERE bytes_uploaded > 50000000 ORDER BY started_at DESC LIMIT 5) x`,
  );
  const recentBps = Number(speed?.seconds) > 60 ? Number(speed?.bytes) / Number(speed?.seconds) : null;

  return (
    <>
      <div className="import-head">
        <h1>Carica dal browser</h1>
        <Link prefetch={false} href="/admin/import" className="muted">
          ← Import
        </Link>
      </div>
      <Uploader
        wasmUrl={EXIFTOOL_WASM_URL}
        recentBps={recentBps}
        testStorage={storage().driver !== "gcs"}
        today={new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long", year: "numeric" }).format(new Date())}
      />
    </>
  );
}
