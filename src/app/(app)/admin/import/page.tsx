import Link from "next/link";
import { Button } from "@/components/ui/button";
import { markImportInterrupted, revokeDeviceKey } from "@/app/actions/imports";
import { query, queryOne } from "@/lib/db";
import { dateTimeFmt, formatBytes, formatCount } from "@/lib/format";
import { countDuplicatePairs } from "@/lib/duplicates";
import { CANDIDATE_JOIN, isStale, type ImportRow } from "@/lib/imports";
import { requireOwner } from "@/lib/session";
import { storage } from "@/lib/storage";
import { AutoRefresh } from "./auto-refresh";
import { ImportProgress, sourceLabel, StatusBadge } from "./import-status";
import { NewDeviceForm } from "./new-device-form";

type DeviceRow = {
  id: number;
  name: string;
  token_hint: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
};

type KindStat = { kind: "raw" | "phone" | "edit"; n: number; bytes: number };

const KIND_LABEL = { raw: "CR2", phone: "Foto del telefono", edit: "Export modificati" } as const;

export default async function ImportPage() {
  await requireOwner();

  const [imports, devices, kinds, review, duplicates] = await Promise.all([
    query<ImportRow & { device_name: string | null }>(
      `SELECT i.*, d.name AS device_name FROM imports i LEFT JOIN import_devices d ON d.id = i.device_id
        ORDER BY i.started_at DESC, i.id DESC LIMIT 100`,
    ),
    query<DeviceRow>(
      `SELECT id, name, token_hint, created_at, last_used_at, revoked_at
         FROM import_devices ORDER BY revoked_at IS NOT NULL, created_at DESC`,
    ),
    query<KindStat>(
      "SELECT kind, COUNT(*) AS n, COALESCE(SUM(file_size), 0) AS bytes FROM photos WHERE deleted_at IS NULL GROUP BY kind",
    ),
    queryOne<{ auto: number; ambiguous: number }>(
      `SELECT (SELECT COUNT(*) FROM photos WHERE kind = 'edit' AND match_status = 'auto' AND deleted_at IS NULL) AS auto,
              (SELECT COUNT(*) FROM (
                 SELECT e.id FROM photos e ${CANDIDATE_JOIN}
                  WHERE e.kind = 'edit' AND e.match_status = 'none' AND e.deleted_at IS NULL
                  GROUP BY e.id HAVING COUNT(*) > 1) x) AS ambiguous`,
    ),
    countDuplicatePairs(),
  ]);

  const running = imports.filter((i) => i.status === "running");
  const toReview = Number(review?.auto ?? 0) + Number(review?.ambiguous ?? 0);
  const activeDevices = devices.filter((d) => !d.revoked_at);
  const totalBytes = kinds.reduce((s, k) => s + Number(k.bytes), 0);

  return (
    <>
      {running.some((i) => !isStale(i)) && <AutoRefresh seconds={3} />}

      <div className="import-head">
        <h1>Import</h1>
        <span className="muted">
          Archivio: {storage().driver === "gcs" ? "Google Cloud Storage" : "cartella locale (modalità di prova)"}
        </span>
      </div>
      <section className="card import-head" style={{ alignItems: "center" }}>
        <div>
          <h2>Google Drive</h2>
          <p className="muted">
            Zip di Google Takeout e cartelle di Drive, importati dal server senza passare dal tuo computer.
          </p>
        </div>
        <Button asChild>
          <Link prefetch={false} href="/admin/import/drive">
            Importa da Google Drive
          </Link>
        </Button>
      </section>

      <div className="import-stats">
        {(["raw", "phone", "edit"] as const).map((k) => {
          const s = kinds.find((x) => x.kind === k);
          return (
            <div className="card" key={k}>
              <div className="stat-value">{formatCount(Number(s?.n ?? 0))}</div>
              <div className="stat-label">{KIND_LABEL[k]}</div>
            </div>
          );
        })}
        <div className="card">
          <div className="stat-value">{formatBytes(totalBytes)}</div>
          <div className="stat-label">Spazio occupato dagli originali</div>
        </div>
        <Link prefetch={false} className="card" href="/admin/import/collegamenti">
          <div className="stat-value">{formatCount(toReview)}</div>
          <div className="stat-label">Collegamenti export → CR2 da rivedere</div>
        </Link>
        <Link prefetch={false} className="card" href="/admin/import/doppioni">
          <div className="stat-value">{formatCount(duplicates)}</div>
          <div className="stat-label">Probabili doppioni da rivedere</div>
        </Link>
      </div>

      {running.map((imp) => (
        <section className="card" key={imp.id}>
          <div className="import-head">
            <h2>
              <Link prefetch={false} href={`/admin/import/${imp.public_id}`}>
                {imp.label}
              </Link>
            </h2>
            <StatusBadge imp={imp} />
          </div>
          <ImportProgress imp={imp} />
          {isStale(imp) && (
            <form action={markImportInterrupted} className="actions">
              <span className="muted">
                Il programma non manda segnali da qualche minuto. Se l&apos;hai chiuso, segna l&apos;import come
                interrotto: rilanciandolo riparte da dove era arrivato.
              </span>
              <input type="hidden" name="importId" value={imp.public_id} />
              <button type="submit" className="secondary">
                Segna come interrotto
              </button>
            </form>
          )}
        </section>
      ))}

      <section className="card table-wrap">
        <h2>Storico</h2>
        {imports.length === 0 ? (
          <p className="muted">Nessun import ancora. Le istruzioni per iniziare sono qui sotto.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Iniziato</th>
                <th>Import</th>
                <th>Fonte</th>
                <th>Stato</th>
                <th>Importati</th>
                <th>Già presenti</th>
                <th>Errori</th>
                <th>Caricati</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((imp) => (
                <tr key={imp.id}>
                  <td>{dateTimeFmt.format(imp.started_at)}</td>
                  <td>
                    <Link prefetch={false} href={`/admin/import/${imp.public_id}`}>
                      {imp.label}
                    </Link>
                  </td>
                  <td>{sourceLabel(imp.source, imp.device_name)}</td>
                  <td>
                    <StatusBadge imp={imp} />
                  </td>
                  <td>{formatCount(imp.files_imported)}</td>
                  <td>{formatCount(imp.files_skipped)}</td>
                  <td className={imp.files_failed > 0 ? "msg-error" : undefined}>{formatCount(imp.files_failed)}</td>
                  <td>{formatBytes(imp.bytes_uploaded)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Computer collegati</h2>
        <p className="muted">
          Il programma di import gira sul tuo computer e si collega all&apos;app con una chiave. Crea una chiave per
          ogni computer; se ne perdi uno, revoca la sua chiave.
        </p>
        {devices.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Computer</th>
                  <th>Chiave</th>
                  <th>Creata</th>
                  <th>Ultimo uso</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id} className={d.revoked_at ? "muted" : undefined}>
                    <td>{d.name}</td>
                    <td>
                      <code>…{d.token_hint}</code>
                    </td>
                    <td>{dateTimeFmt.format(d.created_at)}</td>
                    <td>{d.last_used_at ? dateTimeFmt.format(d.last_used_at) : "mai"}</td>
                    <td>
                      {d.revoked_at ? (
                        "Revocata"
                      ) : (
                        <form action={revokeDeviceKey}>
                          <input type="hidden" name="deviceId" value={d.id} />
                          <button type="submit" className="link">
                            Revoca
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ maxWidth: 520, marginTop: 16 }}>
          <NewDeviceForm />
        </div>
      </section>

      <section className="card">
        <h2>Come si importa</h2>
        <ol>
          <li>
            {activeDevices.length === 0 ? "Crea una chiave qui sopra" : "Usa la chiave del computer"} e mettila nel
            file <code>.env.local</code> della copia del progetto sul tuo computer, insieme all&apos;indirizzo
            dell&apos;app:
            <pre className="cmd">{`IMPORT_SERVER_URL=https://foto.acasolino.com
IMPORT_KEY=pa_...`}</pre>
          </li>
          <li>
            Disco con le foto, CR2 e JPG (una cartella o tutto il disco; ogni cartella diventa un album):
            <pre className="cmd">{`npm run import -- "/Volumes/Disco foto" --etichetta "Disco WD 1TB"`}</pre>
          </li>
          <li>
            Google Foto: il modo più comodo è{" "}
            <Link prefetch={false} href="/admin/import/drive">
              Takeout su Google Drive
            </Link>
            , importato dalla VPS. In alternativa scarica l&apos;archivio da Google Takeout, estrai gli zip in una
            cartella e lancia:
            <pre className="cmd">{`npm run import -- "/Users/antonio/Takeout" --takeout`}</pre>
          </li>
          <li>
            Prima di caricare puoi fare una prova senza inviare nulla: aggiungi <code>--prova</code>. Puoi fermare
            l&apos;import con Ctrl+C e rilanciare lo stesso comando: riparte da dove era arrivato e non carica mai due
            volte lo stesso file.
          </li>
        </ol>
      </section>
    </>
  );
}
