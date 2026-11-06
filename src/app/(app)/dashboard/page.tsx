import { query } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { effectiveDownload, type DownloadLevel } from "@/lib/roles";

type SharedItem = {
  id: number;
  target_type: "photo" | "album";
  title: string | null;
  message: string | null;
  allow_download: DownloadLevel;
  created_at: Date;
  first_viewed_at: Date | null;
};

const DOWNLOAD_LABEL: Record<DownloadLevel, string> = {
  none: "Solo visione",
  preview: "Download JPEG",
  original: "Download originale",
};

export default async function DashboardPage() {
  const user = await requireUser();

  // Tutto ciò che è condiviso con l'utente e ancora valido.
  const items = await query<SharedItem>(
    `SELECT s.id, s.target_type, s.message, s.allow_download, s.created_at, sr.first_viewed_at,
            COALESCE(a.title, p.title, p.original_filename) AS title
       FROM share_recipients sr
       JOIN shares s ON s.id = sr.share_id
       LEFT JOIN albums a ON a.id = s.album_id AND a.deleted_at IS NULL
       LEFT JOIN photos p ON p.id = s.photo_id AND p.deleted_at IS NULL
      WHERE sr.user_id = ?
        AND s.revoked_at IS NULL
        AND (s.expires_at IS NULL OR s.expires_at > UTC_TIMESTAMP())
        AND (a.id IS NOT NULL OR p.id IS NOT NULL)
      ORDER BY s.created_at DESC`,
    [user.id],
  );

  return (
    <>
      <h1>Condivisi con me</h1>
      {items.length === 0 ? (
        <p className="muted">
          {user.role === "owner"
            ? "Sei il proprietario: l'archivio completo arriverà con le prossime funzioni (import e gallerie)."
            : "Non c'è ancora niente di condiviso con te."}
        </p>
      ) : (
        items.map((it) => (
          <section key={it.id} className="card">
            <strong>{it.title}</strong> <span className="muted">· {it.target_type === "album" ? "Album" : "Foto"}</span>
            {!it.first_viewed_at && <span className="msg-ok"> · nuovo</span>}
            {it.message && <p>{it.message}</p>}
            <p className="muted">{DOWNLOAD_LABEL[effectiveDownload(it.allow_download, user.role)]}</p>
          </section>
        ))
      )}
    </>
  );
}
