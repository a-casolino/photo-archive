import "server-only";
import type { StorageClass } from "./cost-rules";
import { query, queryOne } from "./db";

/*
 * Numeri dell'archivio dal database, per la pagina Statistiche (solo owner).
 * Query di aggregazione su tutta la tabella photos: vanno bene per una pagina
 * aperta di rado dal proprietario, non da usare in pagine frequenti.
 */

export type ArchiveStats = {
  kinds: { kind: "raw" | "phone" | "edit"; n: number; bytes: number }[];
  trash: { n: number; bytes: number };
  pendingOriginals: { n: number; bytes: number };
  counts: { albums: number; people: number; faces: number; tags: number; users: number; activeShares: number; namedLinks: number };
  byYear: { year: number | null; n: number; bytes: number }[];
  byMonth: { month: string; n: number; bytes: number }[];
  /** Cosa c'è nel bucket secondo il database (anche le foto nel cestino, finché non eliminate). */
  bucket: {
    originals: { cls: StorageClass; n: number; bytes: number }[];
    previews: number;
    thumbs: number;
    faces: number;
  };
  last30: {
    archiveWrites: number;
    archiveReadBytes: number;
    views: number;
    previewDownloads: number;
    originalDownloads: number;
  };
};

type Num = number | string | null;
const n = (v: Num | undefined) => Number(v ?? 0);

export async function archiveStats(): Promise<ArchiveStats> {
  const [kinds, trash, pending, counts, byYear, byMonth, originals, keys, faces, last30, events] = await Promise.all([
    query<{ kind: "raw" | "phone" | "edit"; n: Num; bytes: Num }>(
      "SELECT kind, COUNT(*) AS n, COALESCE(SUM(file_size), 0) AS bytes FROM photos WHERE deleted_at IS NULL GROUP BY kind",
    ),
    queryOne<{ n: Num; bytes: Num }>(
      "SELECT COUNT(*) AS n, COALESCE(SUM(file_size), 0) AS bytes FROM photos WHERE deleted_at IS NOT NULL",
    ),
    queryOne<{ n: Num; bytes: Num }>(
      "SELECT COUNT(*) AS n, COALESCE(SUM(file_size), 0) AS bytes FROM photos WHERE original_pending = 1 AND deleted_at IS NULL",
    ),
    queryOne<Record<keyof ArchiveStats["counts"], Num>>(
      `SELECT (SELECT COUNT(*) FROM albums WHERE deleted_at IS NULL) AS albums,
              (SELECT COUNT(*) FROM people) AS people,
              (SELECT COUNT(*) FROM faces) AS faces,
              (SELECT COUNT(*) FROM tags) AS tags,
              (SELECT COUNT(*) FROM users WHERE role <> 'owner') AS users,
              (SELECT COUNT(*) FROM shares WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())) AS activeShares,
              (SELECT COUNT(*) FROM named_links) AS namedLinks`,
    ),
    query<{ year: Num; n: Num; bytes: Num }>(
      `SELECT YEAR(taken_at) AS year, COUNT(*) AS n, COALESCE(SUM(file_size), 0) AS bytes
         FROM photos WHERE deleted_at IS NULL GROUP BY YEAR(taken_at) ORDER BY year IS NULL, year`,
    ),
    query<{ month: string; n: Num; bytes: Num }>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS n, COALESCE(SUM(file_size), 0) AS bytes
         FROM photos WHERE created_at >= DATE_SUB(DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01'), INTERVAL 11 MONTH)
        GROUP BY month ORDER BY month`,
    ),
    query<{ cls: StorageClass; n: Num; bytes: Num }>(
      `SELECT gcs_original_class AS cls, COUNT(*) AS n, COALESCE(SUM(file_size), 0) AS bytes
         FROM photos WHERE original_pending = 0 GROUP BY gcs_original_class`,
    ),
    queryOne<{ previews: Num; thumbs: Num }>(
      "SELECT COUNT(gcs_preview_key) AS previews, COUNT(gcs_thumb_key) AS thumbs FROM photos",
    ),
    queryOne<{ n: Num }>("SELECT COUNT(gcs_face_key) AS n FROM faces"),
    queryOne<{ writes: Num }>(
      `SELECT COUNT(*) AS writes FROM photos
        WHERE gcs_original_class = 'ARCHIVE' AND original_pending = 0
          AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)`,
    ),
    query<{ event: string; n: Num; bytes: Num }>(
      `SELECT e.event, COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN p.gcs_original_class = 'ARCHIVE' THEN p.file_size END), 0) AS bytes
         FROM share_events e LEFT JOIN photos p ON p.id = e.photo_id
        WHERE e.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
        GROUP BY e.event`,
    ),
  ]);

  const ev = (name: string) => events.find((e) => e.event === name);
  return {
    kinds: kinds.map((k) => ({ kind: k.kind, n: n(k.n), bytes: n(k.bytes) })),
    trash: { n: n(trash?.n), bytes: n(trash?.bytes) },
    pendingOriginals: { n: n(pending?.n), bytes: n(pending?.bytes) },
    counts: {
      albums: n(counts?.albums),
      people: n(counts?.people),
      faces: n(counts?.faces),
      tags: n(counts?.tags),
      users: n(counts?.users),
      activeShares: n(counts?.activeShares),
      namedLinks: n(counts?.namedLinks),
    },
    byYear: byYear.map((r) => ({ year: r.year === null ? null : n(r.year), n: n(r.n), bytes: n(r.bytes) })),
    byMonth: byMonth.map((r) => ({ month: r.month, n: n(r.n), bytes: n(r.bytes) })),
    bucket: {
      originals: originals.map((r) => ({ cls: r.cls, n: n(r.n), bytes: n(r.bytes) })),
      previews: n(keys?.previews),
      thumbs: n(keys?.thumbs),
      faces: n(faces?.n),
    },
    last30: {
      archiveWrites: n(last30?.writes),
      archiveReadBytes: n(ev("download_original")?.bytes),
      views: n(ev("view")?.n),
      previewDownloads: n(ev("download_preview")?.n),
      originalDownloads: n(ev("download_original")?.n),
    },
  };
}
