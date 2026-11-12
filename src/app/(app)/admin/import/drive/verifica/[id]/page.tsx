import Link from "next/link";
import { notFound } from "next/navigation";
import { queryOne } from "@/lib/db";
import { dateTimeFmt, formatCount } from "@/lib/format";
import { requireOwner } from "@/lib/session";
import type { AlbumCheck, TakeoutCheckReport } from "@/lib/takeout-check";

/*
 * Resoconto della verifica di un Takeout già importato: album per album,
 * foto attese negli zip, presenti nell'archivio, nel cestino e mancanti.
 */

type CheckRow = {
  label: string;
  status: "queued" | "running" | "finished" | "failed";
  message: string | null;
  finished_at: Date | null;
  report: TakeoutCheckReport | null;
};

const STATE_LABEL: Record<AlbumCheck["albumState"], string> = {
  ok: "",
  assente: "album non creato",
  cestino: "album nel cestino",
};

export default async function TakeoutCheckPage({ params }: PageProps<"/admin/import/drive/verifica/[id]">) {
  await requireOwner();
  const { id } = await params;
  const check = await queryOne<CheckRow>(
    "SELECT label, status, message, finished_at, report FROM drive_checks WHERE public_id = ?",
    [id],
  );
  if (!check) notFound();
  const r = check.report;

  const header = (
    <>
      <p>
        <Link prefetch={false} href="/admin/import/drive">
          ← Import da Google Drive
        </Link>
      </p>
      <h1>Verifica: {check.label}</h1>
    </>
  );
  if (!r) {
    return (
      <>
        {header}
        <p className="muted">{check.status === "failed" ? `Verifica fallita: ${check.message}` : "Verifica non ancora finita."}</p>
      </>
    );
  }

  const problems = r.albums.filter((a) => a.missing + a.trashed > 0 || a.albumState !== "ok");
  const ok = r.albums.length - problems.length;

  return (
    <>
      {header}
      <section className="card">
        {problems.length === 0 ? (
          <p className="msg msg-ok" role="status">
            Tutto presente: tutte le {formatCount(r.expected)} foto degli album del Takeout sono nell&apos;archivio, nei
            loro album.
          </p>
        ) : (
          <p className="msg msg-error" role="alert">
            {problems.length === 1 ? "Un album ha" : `${formatCount(problems.length)} album hanno`} foto mancanti o nel
            cestino: vedi sotto. Non cancellare ancora gli zip da Drive.
          </p>
        )}
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <td>Foto negli album del Takeout</td>
                <td>{formatCount(r.expected)}</td>
              </tr>
              <tr>
                <td>Presenti nell&apos;archivio</td>
                <td>{formatCount(r.found)}</td>
              </tr>
              <tr>
                <td>Presenti ma nel cestino</td>
                <td>{formatCount(r.trashed)}</td>
              </tr>
              <tr>
                <td>Mancanti</td>
                <td>{formatCount(r.missing)}</td>
              </tr>
              <tr>
                <td>Album</td>
                <td>
                  {formatCount(r.albums.length)} ({formatCount(ok)} completi)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          Saltati di proposito: {formatCount(r.outsideAlbums)} file fuori dagli album (cartelle degli anni, cestino,
          WhatsApp), {formatCount(r.videos)} video, {formatCount(r.others)} altri file. Letti {formatCount(r.zips)} zip
          {check.finished_at ? `, verifica del ${dateTimeFmt.format(check.finished_at)}` : ""}.
        </p>
      </section>

      {problems.length > 0 && (
        <section className="card">
          <h2>Album da controllare</h2>
          {problems.map((a) => (
            <details key={a.ref}>
              <summary>
                <strong>{a.title ?? a.ref}</strong> · attese {formatCount(a.expected)}, presenti {formatCount(a.found)}
                {a.trashed > 0 && `, nel cestino ${formatCount(a.trashed)}`}
                {a.missing > 0 && `, mancanti ${formatCount(a.missing)}`}
                {a.albumState !== "ok" && ` · ${STATE_LABEL[a.albumState]}`}
              </summary>
              {a.missingNames.length > 0 && (
                <ul>
                  {a.missingNames.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                  {a.missing > a.missingNames.length && (
                    <li className="muted">… e altri {formatCount(a.missing - a.missingNames.length)}</li>
                  )}
                </ul>
              )}
            </details>
          ))}
        </section>
      )}

      <section className="card table-wrap">
        <h2>Tutti gli album</h2>
        <table>
          <thead>
            <tr>
              <th>Album</th>
              <th>Attese</th>
              <th>Presenti</th>
              <th>Nel cestino</th>
              <th>Mancanti</th>
              <th>Video saltati</th>
            </tr>
          </thead>
          <tbody>
            {r.albums.map((a) => (
              <tr key={a.ref}>
                <td>
                  {a.title ?? a.ref}
                  {a.albumState !== "ok" && <div className="msg-error">{STATE_LABEL[a.albumState]}</div>}
                </td>
                <td>{formatCount(a.expected)}</td>
                <td>{formatCount(a.found)}</td>
                <td>{a.trashed ? formatCount(a.trashed) : ""}</td>
                <td className={a.missing ? "msg-error" : undefined}>{a.missing ? formatCount(a.missing) : ""}</td>
                <td>{a.videos ? formatCount(a.videos) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {r.archiveOnlyAlbums.length > 0 && (
        <section className="card">
          <h2>Album di Google Foto non presenti in questo Takeout</h2>
          <p className="muted">Arrivano da import precedenti: la verifica non li tocca.</p>
          <ul>
            {r.archiveOnlyAlbums.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
