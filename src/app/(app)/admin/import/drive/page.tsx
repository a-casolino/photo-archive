import Link from "next/link";
import {
  cancelDriveImport,
  disconnectDriveAction,
  queueDriveFolder,
  queueTakeoutExport,
  retryDriveImport,
  startDriveConnection,
} from "@/app/actions/drive";
import { query } from "@/lib/db";
import { browseFolder, listTakeoutFiles, storageQuota, type FolderView, type StorageQuota } from "@/lib/drive-browse";
import { groupTakeoutExports, type TakeoutExport } from "@/lib/drive-rules";
import { dateTimeFmt, formatBytes, formatCount } from "@/lib/format";
import { DriveAuthError, DriveClient, driveAccount, driveConfigured, driveRedirectUri } from "@/lib/google-drive";
import { requireOwner } from "@/lib/session";
import { AutoRefresh } from "../auto-refresh";

/*
 * Import da Google Drive: il proprietario collega Drive (sola lettura),
 * sceglie un export di Takeout o una cartella e li mette in coda. Il lavoro
 * lo fa `npm run drive` sulla VPS (cron), senza passare dal suo computer.
 */

type QueueRow = {
  public_id: string;
  kind: "takeout" | "folder";
  label: string;
  drive_ids: string[];
  status: "queued" | "running" | "finished" | "failed" | "cancelled";
  message: string | null;
  batches_total: number | null;
  batches_done: number;
  files_total: number | null;
  bytes_total: number | null;
  created_at: Date;
  finished_at: Date | null;
  heartbeat_at: Date | null;
};

const STATUS_LABEL: Record<QueueRow["status"], string> = {
  queued: "In coda",
  running: "In corso",
  finished: "Completato",
  failed: "Fallito",
  cancelled: "Annullato",
};

const ERRORS: Record<string, string> = {
  config: "Mancano le variabili GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_TOKEN_SECRET sulla VPS.",
  stato: "Il collegamento è scaduto o è partito da un'altra finestra: riprova.",
  negato: "Google non ha dato il permesso (consenso annullato).",
  google: "Google ha rifiutato il collegamento. Controlla client OAuth e URI di reindirizzamento, poi riprova.",
  scollegato: "Google Drive non è collegato.",
  takeout: "Export di Takeout non trovato su Drive (o in formato .tgz).",
  cartella: "Cartella non trovata su Drive.",
};

export default async function DriveImportPage({ searchParams }: PageProps<"/admin/import/drive">) {
  await requireOwner();
  const sp = await searchParams;
  const error = typeof sp.errore === "string" ? ERRORS[sp.errore] : undefined;
  const folderParam = typeof sp.cartella === "string" && /^([A-Za-z0-9_-]{5,200}|shared)$/.test(sp.cartella) ? sp.cartella : "root";

  const header = (
    <>
      <p>
        <Link prefetch={false} href="/admin/import">
          ← Import
        </Link>
      </p>
      <h1>Import da Google Drive</h1>
      {error && (
        <p className="msg msg-error" role="alert">
          {error}
        </p>
      )}
      {sp.collegato && (
        <p className="msg msg-ok" role="status">
          Google Drive collegato.
        </p>
      )}
    </>
  );

  if (!driveConfigured()) return <>{header}<SetupHelp /></>;

  const account = await driveAccount();
  if (!account) {
    return (
      <>
        {header}
        <section className="card">
          <p>
            Collega il tuo Google Drive in <strong>sola lettura</strong>. La VPS potrà leggere gli zip di Google Takeout
            e le cartelle che scegli tu, e importarli nell&apos;archivio senza passare dal tuo computer.
          </p>
          <form action={startDriveConnection}>
            <button type="submit">Collega Google Drive</button>
          </form>
        </section>
      </>
    );
  }

  const queue = await query<QueueRow>(
    `SELECT public_id, kind, label, drive_ids, status, message, batches_total, batches_done, files_total, bytes_total,
            created_at, finished_at, heartbeat_at
       FROM drive_imports ORDER BY created_at DESC LIMIT 30`,
  );
  const active = queue.filter((q) => q.status === "queued" || q.status === "running");

  let exports: TakeoutExport[] = [];
  let view: FolderView | null = null;
  let quota: StorageQuota | null = null;
  let driveError: string | null = null;
  try {
    const client = (await DriveClient.forOwner())!;
    [exports, view, quota] = await Promise.all([
      listTakeoutFiles(client).then(groupTakeoutExports),
      browseFolder(client, folderParam),
      storageQuota(client).catch(() => null),
    ]);
  } catch (e) {
    driveError = e instanceof DriveAuthError ? e.message : `Drive non risponde: ${(e as Error).message}`;
  }

  const lastDone = (firstId: string) =>
    queue.find((q) => q.status === "finished" && q.drive_ids.includes(firstId))?.finished_at ?? null;
  const isQueued = (firstId: string) => active.some((q) => q.drive_ids.includes(firstId));

  return (
    <>
      {active.length > 0 && <AutoRefresh seconds={10} />}
      {header}

      <section className="card">
        <div className="import-head">
          <span>
            Collegato a <strong>{account.email ?? "Google Drive"}</strong> (sola lettura)
          </span>
          <form action={disconnectDriveAction}>
            <button type="submit" className="link">
              Scollega
            </button>
          </form>
        </div>
        {quota && <QuotaInfo quota={quota} />}
        {driveError && (
          <p className="msg msg-error" role="alert">
            {driveError}
          </p>
        )}
        {driveError && (
          <form action={startDriveConnection}>
            <button type="submit">Ricollega Google Drive</button>
          </form>
        )}
      </section>

      {queue.length > 0 && <QueueSection queue={queue} />}

      {view && (
        <section className="card">
          <h2>Google Takeout</h2>
          <p className="muted">
            Su <a href="https://takeout.google.com" target="_blank" rel="noreferrer">takeout.google.com</a> scegli
            Google Foto, poi «Aggiungi a Drive», tipo di file <strong>.zip</strong> e dimensione 10 GB. Quando Google
            ha finito, gli zip compaiono qui. Album, date, descrizioni e posizioni vengono dai file JSON di Takeout. Le
            cartelle «Photos from …» non diventano album.
          </p>
          {exports.length === 0 ? (
            <p className="muted">Nessun export di Takeout trovato su Drive.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Export</th>
                    <th>Zip</th>
                    <th>Dimensione</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {exports.map((g) => {
                    const done = lastDone(g.parts[0].id);
                    return (
                      <tr key={g.key}>
                        <td>{dateTimeFmt.format(g.createdAt)}</td>
                        <td>{g.parts.length}</td>
                        <td>{formatBytes(g.bytes)}</td>
                        <td>
                          {g.tgz ? (
                            <span className="muted">Formato .tgz: rifallo in .zip</span>
                          ) : isQueued(g.parts[0].id) ? (
                            <span className="muted">In coda</span>
                          ) : (
                            <form action={queueTakeoutExport} className="actions">
                              <input type="hidden" name="key" value={g.key} />
                              <button type="submit" className={done ? "secondary" : undefined}>
                                {done ? "Importa di nuovo" : "Importa"}
                              </button>
                              {done && <span className="muted">già importato il {dateTimeFmt.format(done)}</span>}
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {view && <FolderSection view={view} current={folderParam} isQueued={isQueued} lastDone={lastDone} />}

      <section className="card">
        <h2>Come funziona</h2>
        <ul>
          <li>
            Ogni 15 minuti la VPS guarda la coda e lavora un import alla volta, a lotti di qualche GB: scarica il lotto da
            Drive, crea le anteprime, carica tutto su Google Cloud e cancella i file temporanei.
          </li>
          <li>
            Ogni lotto compare come import nella pagina <Link prefetch={false} href="/admin/import">Import</Link>, con
            avanzamento ed errori. Le foto già presenti non vengono caricate due volte.
          </li>
          <li>I video per ora vengono saltati. L&apos;app non cancella né modifica niente su Drive.</li>
          <li>Finito l&apos;import, puoi cancellare gli zip di Takeout da Drive per liberare spazio.</li>
        </ul>
      </section>
    </>
  );
}

function QueueSection({ queue }: { queue: QueueRow[] }) {
  return (
    <section className="card table-wrap">
      <h2>Coda</h2>
      <table>
        <thead>
          <tr>
            <th>Aggiunto</th>
            <th>Cosa</th>
            <th>Stato</th>
            <th>Avanzamento</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {queue.map((q) => (
            <tr key={q.public_id}>
              <td>{dateTimeFmt.format(q.created_at)}</td>
              <td>
                {q.kind === "takeout" ? "" : "Cartella "}
                {q.label}
                {q.files_total !== null && (
                  <div className="muted">
                    {formatCount(q.files_total)} foto · {formatBytes(q.bytes_total)}
                  </div>
                )}
              </td>
              <td>
                <span className={`badge badge-${q.status}`}>{STATUS_LABEL[q.status]}</span>
              </td>
              <td>
                {q.batches_total ? `lotto ${Math.min(q.batches_done + 1, q.batches_total)} di ${q.batches_total}` : ""}
                {q.message && <div className={q.status === "failed" ? "msg-error" : "muted"}>{q.message}</div>}
                {q.status === "queued" && !q.heartbeat_at && (
                  <div className="muted">Parte al prossimo giro della VPS (entro 15 minuti).</div>
                )}
              </td>
              <td>
                {(q.status === "queued" || q.status === "running") && (
                  <form action={cancelDriveImport}>
                    <input type="hidden" name="id" value={q.public_id} />
                    <button type="submit" className="link">
                      Annulla
                    </button>
                  </form>
                )}
                {(q.status === "failed" || q.status === "cancelled") && (
                  <form action={retryDriveImport}>
                    <input type="hidden" name="id" value={q.public_id} />
                    <button type="submit" className="link">
                      Riprova
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function FolderSection({
  view,
  current,
  isQueued,
  lastDone,
}: {
  view: FolderView;
  current: string;
  isQueued: (id: string) => boolean;
  lastDone: (id: string) => Date | null;
}) {
  const href = (id: string) => `/admin/import/drive?cartella=${encodeURIComponent(id)}`;
  const queueButton = (id: string, label: string) => {
    if (isQueued(id)) return <span className="muted">In coda</span>;
    const done = lastDone(id);
    return (
      <form action={queueDriveFolder} className="actions">
        <input type="hidden" name="folderId" value={id} />
        <button type="submit" className={done ? "secondary" : undefined}>
          {done ? `${label} di nuovo` : label}
        </button>
        {done && <span className="muted">già importata il {dateTimeFmt.format(done)}</span>}
      </form>
    );
  };

  return (
    <section className="card">
      <h2>Cartelle di Drive</h2>
      <p className="muted">
        Importa una cartella con le sue sottocartelle: ogni cartella diventa un album, come per il disco. CR2, JPG,
        HEIC e PNG; gli export di Lightroom vengono collegati al loro CR2.
      </p>
      <p className="actions">
        <Link prefetch={false} href={href("root")}>
          Il mio Drive
        </Link>
        <span className="muted">·</span>
        <Link prefetch={false} href={href("shared")}>
          Condivisi con me
        </Link>
        {view.folder?.parents?.[0] && (
          <>
            <span className="muted">·</span>
            <Link prefetch={false} href={href(view.folder.parents[0])}>
              ↑ Cartella superiore
            </Link>
          </>
        )}
      </p>

      {view.folder && (
        <div className="import-head">
          <h3>📁 {view.folder.name}</h3>
          {queueButton(view.folder.id, "Importa questa cartella")}
        </div>
      )}
      {view.folder && (
        <p className="muted">
          Qui dentro: {formatCount(view.images)} immagini, {formatCount(view.folders.length)} sottocartelle
          {view.others ? `, ${formatCount(view.others)} altri file` : ""}.
        </p>
      )}
      {current === "root" && <h3>Il mio Drive</h3>}
      {current === "shared" && <h3>Condivisi con me</h3>}

      {view.folders.length === 0 ? (
        <p className="muted">Nessuna sottocartella.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <tbody>
              {view.folders.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Link prefetch={false} href={href(f.id)}>
                      📁 {f.name}
                    </Link>
                  </td>
                  <td>{queueButton(f.id, "Importa")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SetupHelp() {
  return (
    <section className="card">
      <h2>Da configurare</h2>
      <p>Per leggere Drive l&apos;app ha bisogno di un client OAuth di Google. Una volta sola:</p>
      <ol>
        <li>
          Nel progetto Google Cloud «Foto»: <em>API e servizi → Libreria</em>, attiva <strong>Google Drive API</strong>.
        </li>
        <li>
          <em>Schermata consenso OAuth</em>: tipo «Esterno», aggiungi il tuo indirizzo tra gli utenti di prova, poi
          «Pubblica app» (così il collegamento non scade dopo 7 giorni; Google mostrerà un avviso «app non verificata»,
          normale per un&apos;app personale).
        </li>
        <li>
          <em>Credenziali → Crea credenziali → ID client OAuth</em>, tipo «Applicazione web», URI di reindirizzamento
          autorizzato:
          <pre className="cmd">{driveRedirectUri()}</pre>
        </li>
        <li>
          Nelle variabili del sito su xCloud aggiungi ID e segreto del client e un segreto casuale di almeno 32
          caratteri:
          <pre className="cmd">{`GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_TOKEN_SECRET=...`}</pre>
        </li>
        <li>
          Aggiungi il cron sulla VPS, ogni 15 minuti:
          <pre className="cmd">{`nice -n 15 npm run drive`}</pre>
        </li>
      </ol>
    </section>
  );
}

/** Spazio dell'account Google (condiviso fra Drive, Gmail e Google Foto). */
function QuotaInfo({ quota }: { quota: StorageQuota }) {
  const other = Math.max(0, quota.usage - quota.usageInDrive - quota.usageInDriveTrash);
  return (
    <p className="muted">
      Spazio Google: {formatBytes(quota.usage)} usati
      {quota.limit !== null && (
        <>
          {" "}
          di {formatBytes(quota.limit)}, <strong>{formatBytes(Math.max(0, quota.limit - quota.usage))} liberi</strong>
        </>
      )}
      . Drive {formatBytes(quota.usageInDrive)}
      {quota.usageInDriveTrash > 0 && <> (più {formatBytes(quota.usageInDriveTrash)} nel cestino)</>}, Google Foto e
      Gmail {formatBytes(other)}. L&apos;export di Takeout occupa su Drive circa quanto le foto esportate, finché non
      cancelli gli zip.
    </p>
  );
}
