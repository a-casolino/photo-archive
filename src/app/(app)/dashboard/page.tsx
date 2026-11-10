import { redirect } from "next/navigation";
import { Masonry, type MasonryItem } from "@/app/ui/gallery/masonry";
import { ratioOf } from "@/app/ui/gallery/views";
import { query } from "@/lib/db";
import { albumCoverId, branchCoverId, branchPhotoCount, linkedExport, signKeys } from "@/lib/gallery";
import { effectiveDownload, type DownloadLevel } from "@/lib/roles";
import { requireUser } from "@/lib/session";

type SharedItem = {
  public_id: string;
  target_type: "photo" | "album";
  title: string | null;
  message: string | null;
  allow_download: DownloadLevel;
  created_at: Date;
  first_viewed_at: Date | null;
  thumb_key: string | null;
  width: number | null;
  height: number | null;
  orientation: number | null;
  photo_count: number | null;
};

const DOWNLOAD_LABEL: Record<DownloadLevel, string> = {
  none: "solo visione",
  preview: "download JPEG",
  original: "download originale",
};

const day = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeZone: "Europe/Rome" });

export default async function DashboardPage() {
  const user = await requireUser();
  // Il proprietario vede tutto l'archivio: la sua pagina iniziale sono gli album.
  if (user.role === "owner") redirect("/album");

  // Tutto ciò che è condiviso con l'utente e ancora valido, con la
  // copertina (o la foto) nella versione mostrata (export di Lightroom se c'è).
  const items = await query<SharedItem>(
    `SELECT s.public_id, s.target_type, s.message, s.allow_download, s.created_at, sr.first_viewed_at,
            COALESCE(a.title, p.title, p.original_filename) AS title,
            COALESCE(x.gcs_thumb_key, c.gcs_thumb_key) AS thumb_key,
            IF(x.id IS NULL, c.width, x.width) AS width,
            IF(x.id IS NULL, c.height, x.height) AS height,
            IF(x.id IS NULL, c.orientation, x.orientation) AS orientation,
            IF(a.id IS NULL, NULL, ${branchPhotoCount("a")}) AS photo_count
       FROM share_recipients sr
       JOIN shares s ON s.id = sr.share_id
       LEFT JOIN albums a ON a.id = s.album_id AND a.deleted_at IS NULL
       LEFT JOIN photos p ON p.id = s.photo_id AND p.deleted_at IS NULL
       LEFT JOIN LATERAL (SELECT COALESCE(${albumCoverId("a")}, ${branchCoverId("a")}) AS id) ac ON TRUE
       LEFT JOIN photos c ON c.id = COALESCE(p.id, ac.id) AND c.deleted_at IS NULL
       ${linkedExport("active", "c")}
      WHERE sr.user_id = ?
        AND s.revoked_at IS NULL
        AND (s.expires_at IS NULL OR s.expires_at > UTC_TIMESTAMP())
        AND (a.id IS NOT NULL OR p.id IS NOT NULL)
      ORDER BY s.created_at DESC`,
    [user.id],
  );
  const urls = await signKeys(items.map((it) => it.thumb_key));

  const tiles: MasonryItem[] = items.map((it) => ({
    key: it.public_id,
    href: `/condivisi/${it.public_id}`,
    src: it.thumb_key ? (urls.get(it.thumb_key) ?? null) : null,
    alt: it.title ?? "",
    ratio: ratioOf(it),
    badge: it.first_viewed_at ? undefined : "Nuovo",
    caption: {
      title: it.title ?? "",
      detail: [
        it.target_type === "album" ? `Album · ${it.photo_count ?? 0} foto` : "Foto",
        DOWNLOAD_LABEL[effectiveDownload(it.allow_download, user.role)],
        day.format(it.created_at),
      ].join(" · "),
    },
  }));

  return (
    <>
      <h1>Condivisi con me</h1>
      {items.length === 0 ? (
        <p className="muted">Non c&apos;è ancora niente di condiviso con te.</p>
      ) : (
        <Masonry items={tiles} />
      )}
    </>
  );
}
