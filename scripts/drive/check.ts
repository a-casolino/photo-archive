/*
 * Verifica di un export di Takeout già importato (coda drive_checks, lavorata
 * da `npm run drive`). Legge solo l'indice degli zip su Drive, con le stesse
 * regole dell'import (solo album, niente anni, cestino e WhatsApp, niente
 * video), e confronta album per album con l'archivio. Il resoconto finisce in
 * drive_checks.report e si legge nella pagina Import → Google Drive.
 */
import type yauzl from "yauzl";
import { execute, query } from "../../src/lib/db";
import type { DriveClient } from "../../src/lib/google-drive";
import {
  compareAlbum,
  sortAlbumChecks,
  type AlbumCheck,
  type ArchivedFile,
  type TakeoutCheckReport,
} from "../../src/lib/takeout-check";
import { expectedFromEntries, type ExpectedAlbums } from "./check-rules";
import { openDriveZip, zipEntries } from "./zip-reader";

type AlbumRow = { id: number; origin_ref: string; title: string; deleted_at: Date | null };
type PhotoRow = { album_id: number; original_filename: string; file_size: number; deleted_at: Date | null };

/** Confronta le foto attese con gli album Google Foto dell'archivio. */
export async function compareWithArchive(exp: ExpectedAlbums, zips: number): Promise<TakeoutCheckReport> {
  const albumRows = await query<AlbumRow>(
    "SELECT id, origin_ref, title, deleted_at FROM albums WHERE origin = 'google_photos'",
  );
  const byRef = new Map(albumRows.map((a) => [a.origin_ref, a]));
  const wanted = albumRows.filter((a) => exp.albums.has(a.origin_ref)).map((a) => a.id);
  const photos = new Map<number, ArchivedFile[]>();
  for (let i = 0; i < wanted.length; i += 500) {
    const rows = await query<PhotoRow>(
      `SELECT ap.album_id, p.original_filename, p.file_size, p.deleted_at
         FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
        WHERE ap.album_id IN (?)`,
      [wanted.slice(i, i + 500)],
    );
    for (const r of rows) {
      const list = photos.get(r.album_id) ?? [];
      list.push({ name: r.original_filename, size: Number(r.file_size), trashed: r.deleted_at !== null });
      photos.set(r.album_id, list);
    }
  }

  const albums: AlbumCheck[] = [];
  for (const [ref, e] of exp.albums) {
    if (e.files.length === 0) continue; // solo video: l'import non crea niente
    const row = byRef.get(ref);
    const cmp = compareAlbum(e.files, row ? (photos.get(row.id) ?? []) : []);
    albums.push({
      ref,
      title: row?.title ?? null,
      albumState: !row ? "assente" : row.deleted_at ? "cestino" : "ok",
      videos: e.videos,
      ...cmp,
    });
  }
  const sum = (k: "expected" | "found" | "trashed" | "missing") => albums.reduce((s, a) => s + a[k], 0);
  return {
    zips,
    outsideAlbums: exp.outsideAlbums,
    videos: exp.videos,
    others: exp.others,
    expected: sum("expected"),
    found: sum("found"),
    trashed: sum("trashed"),
    missing: sum("missing"),
    albums: sortAlbumChecks(albums),
    archiveOnlyAlbums: albumRows
      .filter((a) => !a.deleted_at && !exp.albums.has(a.origin_ref))
      .map((a) => a.title)
      .sort((a, b) => a.localeCompare(b, "it")),
  };
}

type Check = { id: number; label: string; drive_ids: string[] };

/** Lavora una verifica in coda: indice degli zip, confronto, resoconto. */
export async function runTakeoutCheck(client: DriveClient, check: Check, log: (msg: string) => void): Promise<void> {
  const entries: { fileName: string; size: number }[] = [];
  for (const [i, id] of check.drive_ids.entries()) {
    await execute("UPDATE drive_checks SET message = ? WHERE id = ?", [
      `Leggo l'indice dello zip ${i + 1} di ${check.drive_ids.length}…`,
      check.id,
    ]);
    const meta = await client.file(id);
    let zip: yauzl.ZipFile | null = null;
    try {
      zip = await openDriveZip(client, id, Number(meta.size));
      for (const e of await zipEntries(zip)) entries.push({ fileName: e.fileName, size: e.uncompressedSize });
    } finally {
      zip?.close();
    }
  }
  const report = await compareWithArchive(expectedFromEntries(entries), check.drive_ids.length);
  log(
    `Verifica «${check.label}»: attese ${report.expected}, nell'archivio ${report.found}, ` +
      `nel cestino ${report.trashed}, mancanti ${report.missing}`,
  );
  await execute(
    "UPDATE drive_checks SET status = 'finished', finished_at = UTC_TIMESTAMP(), message = NULL, report = ? WHERE id = ?",
    [JSON.stringify(report), check.id],
  );
}
