import Link from "next/link";
import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { dateTimeFmt, formatCount } from "@/lib/format";
import { isStale, type ImportRow } from "@/lib/imports";
import { requireOwner } from "@/lib/session";
import { importPhotoCount } from "@/lib/trash";
import { trashImportPhotosAction } from "@/app/actions/trash";
import { Button } from "@/components/ui/button";
import { AutoRefresh } from "../auto-refresh";
import { ImportProgress, sourceLabel, StatusBadge } from "../import-status";

type ErrorRow = { id: number; source_path: string; message: string; created_at: Date };

const MAX_ERRORS = 500;
const MAX_FOLDERS = 300;

export default async function ImportDetailPage({ params, searchParams }: PageProps<"/admin/import/[id]">) {
  await requireOwner();
  const { id } = await params;
  const trashed = (await searchParams).cestino;
  const imp = await queryOne<ImportRow & { device_name: string | null }>(
    `SELECT i.*, d.name AS device_name FROM imports i
       LEFT JOIN import_devices d ON d.id = i.device_id
      WHERE i.public_id = ?`,
    [id],
  );
  if (!imp) notFound();

  const errors = await query<ErrorRow>(
    "SELECT id, source_path, message, created_at FROM import_errors WHERE import_id = ? ORDER BY id DESC LIMIT ?",
    [imp.id, MAX_ERRORS],
  );
  const photoCount = await importPhotoCount(imp.id);
  // Cartelle da cui arrivano le foto (anche quelle poi messe nel cestino).
  const folders = await query<{ folder: string; n: number; trashed: number }>(
    `SELECT f.folder, COUNT(*) AS n, SUM(f.deleted_at IS NOT NULL) AS trashed
       FROM (SELECT deleted_at,
                    IF(LOCATE('/', source_path) = 0, '',
                       LEFT(source_path, CHAR_LENGTH(source_path) - CHAR_LENGTH(SUBSTRING_INDEX(source_path, '/', -1)) - 1)) AS folder
               FROM photos WHERE import_id = ?) AS f
      GROUP BY f.folder ORDER BY n DESC, f.folder LIMIT ?`,
    [imp.id, MAX_FOLDERS],
  );

  return (
    <>
      {imp.status === "running" && !isStale(imp) && <AutoRefresh seconds={3} />}
      <p>
        <Link prefetch={false} href="/admin/import">
          ← Import
        </Link>
      </p>
      <div className="import-head">
        <h1>{imp.label}</h1>
        <StatusBadge imp={imp} />
      </div>

      <section className="card">
        <div className="counters">
          <span>Fonte: {sourceLabel(imp.source, imp.device_name, imp.label)}</span>
          <span>Computer: {imp.device_name ?? "—"}</span>
          <span>Iniziato: {dateTimeFmt.format(imp.started_at)}</span>
          {imp.finished_at && <span>Finito: {dateTimeFmt.format(imp.finished_at)}</span>}
        </div>
        {imp.root_path && <p className="current-file">Cartella: {imp.root_path}</p>}
        <ImportProgress imp={imp} />
      </section>

      {typeof trashed === "string" && (
        <p className="msg msg-ok" role="status">
          {formatCount(Number(trashed) || 0)} foto spostate nel cestino. Le puoi ripristinare dal cestino per 30 giorni.
        </p>
      )}

      {imp.status !== "running" && photoCount > 0 && (
        <section className="card">
          <h2>Foto di questo import</h2>
          <p className="muted">
            Sono entrate con questo import {formatCount(photoCount)} foto ancora nell&apos;archivio. Puoi spostarle tutte
            nel cestino: quelle che l&apos;import aveva trovato già presenti restano, e un CR2 collegato a un export di
            questo import resta al suo posto.
          </p>
          <form action={trashImportPhotosAction}>
            <input type="hidden" name="importId" value={imp.public_id} />
            <Button type="submit" variant="destructive">
              Sposta nel cestino {formatCount(photoCount)} foto
            </Button>
          </form>
        </section>
      )}

      {folders.length > 0 && (
        <section className="card table-wrap">
          <h2>Cartelle</h2>
          <p className="muted">
            Da dove arrivano le foto entrate con questo import, comprese quelle poi spostate nel cestino.
            {folders.length === MAX_FOLDERS && ` Sono mostrate le ${MAX_FOLDERS} con più foto.`}
          </p>
          <table>
            <thead>
              <tr>
                <th>Cartella</th>
                <th>Foto</th>
                <th>Nel cestino</th>
              </tr>
            </thead>
            <tbody>
              {folders.map((f) => (
                <tr key={f.folder}>
                  <td className="current-file">{f.folder || "—"}</td>
                  <td>{formatCount(Number(f.n))}</td>
                  <td>{formatCount(Number(f.trashed))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card table-wrap">
        <h2>Errori ({formatCount(imp.files_failed)})</h2>
        {errors.length === 0 ? (
          <p className="muted">Nessun errore.</p>
        ) : (
          <>
            <p className="muted">
              I file con errore non sono stati importati. Rilanciando l&apos;import vengono ritentati.
              {imp.files_failed > MAX_ERRORS && ` Sono mostrati gli ultimi ${MAX_ERRORS}.`}
            </p>
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Motivo</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e) => (
                  <tr key={e.id}>
                    <td className="current-file">{e.source_path}</td>
                    <td>{e.message}</td>
                    <td>{dateTimeFmt.format(e.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {imp.log && (
        <section className="card">
          <h2>Riepilogo del programma</h2>
          <pre className="log">{imp.log}</pre>
        </section>
      )}
    </>
  );
}
