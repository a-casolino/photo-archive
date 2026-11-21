import "server-only";
import type { Metadata } from "next";
import { cache } from "react";
import { queryOne } from "@/lib/db";
import { albumBranchSummary, albumCoverId, branchCoverId, getPhoto, getPhotoById, type PhotoDetail } from "@/lib/gallery";
import { formatTakenDay } from "@/lib/format";
import { albumPreviewDescription, clip, PREVIEW_IMAGE_HEIGHT, PREVIEW_IMAGE_WIDTH, SITE_NAME } from "@/lib/link-preview-rules";
import { appUrl } from "@/lib/mail";
import { getLinkShare, shareCoversPhoto, type ShareRow } from "@/lib/shares";
import { albumDates } from "./dates";
import { sharedAlbum } from "./share-views";

/*
 * Anteprima dei link liberi (/l/<token> e /l/<nome>) su WhatsApp, Facebook,
 * Telegram, X, LinkedIn…: tag Open Graph e Twitter con il nome dell'album (o
 * della foto) e la copertina. L'immagine è servita da /l/<token>/anteprima,
 * che controlla di nuovo il link: si vede solo ciò che il link già mostra.
 *
 * Le condivisioni protette (/condivisi/<id>) non hanno anteprima propria:
 * senza login si arriva al login, che mostra solo il nome del sito.
 */

/** Il link libero, letto una volta sola per richiesta (metadati + pagina). */
export const linkShareOnce = cache(getLinkShare);

/** Copertina effettiva dell'album (scelta, prima foto o presa dai sotto-album). */
async function albumCover(albumId: number): Promise<PhotoDetail | null> {
  const row = await queryOne<{ id: number | null }>(
    `SELECT COALESCE(${albumCoverId("a")}, ${branchCoverId("a")}) AS id FROM albums a WHERE a.id = ?`,
    [albumId],
  );
  return row?.id ? getPhotoById(row.id) : null;
}

/** Titolo di una foto: il titolo vero non si mostra ai link liberi, quindi solo la data. */
function photoTitle(p: PhotoDetail): string {
  return p.taken_at ? `Foto del ${formatTakenDay(p.taken_at)}` : "Foto";
}

function build(m: { token: string; title: string; description: string; path: string; photo: PhotoDetail | null }): Metadata {
  const title = clip(m.title, 90);
  const url = appUrl(m.path);
  const images =
    m.photo && (m.photo.preview_key || m.photo.thumb_key)
      ? [
          {
            url: appUrl(`/l/${encodeURIComponent(m.token)}/anteprima?p=${m.photo.public_id}`),
            width: PREVIEW_IMAGE_WIDTH,
            height: PREVIEW_IMAGE_HEIGHT,
            type: "image/jpeg",
            alt: title,
          },
        ]
      : undefined;
  return {
    title: `${title} | ${SITE_NAME}`,
    description: m.description || undefined,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "it_IT",
      title,
      description: m.description || undefined,
      url,
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title,
      description: m.description || undefined,
      images: images?.map((i) => i.url),
    },
  };
}

/** Metadati della pagina /l/<token> (album o foto condivisa, anche un sotto-album con ?album=). */
export async function linkShareMetadata(
  token: string,
  searchParams: Record<string, string | string[] | undefined>,
  photoPid: string | null = null,
): Promise<Metadata> {
  const share = await linkShareOnce(token);
  if (!share) return { title: `Link non disponibile | ${SITE_NAME}` };
  return photoPid ? photoMetadata(share, token, photoPid) : homeMetadata(share, token, searchParams);
}

async function homeMetadata(
  share: ShareRow,
  token: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<Metadata> {
  const base = `/l/${token}`;
  if (share.target_type === "photo") {
    const photo = share.photo_id ? await getPhotoById(share.photo_id) : null;
    if (!photo) return { title: SITE_NAME };
    return build({ token, title: photoTitle(photo), description: photoDescription(share, photo), path: base, photo });
  }
  const where = await sharedAlbum(share, searchParams.album);
  if (!where) return { title: SITE_NAME };
  const { album } = where;
  const [branch, cover] = await Promise.all([albumBranchSummary(album.id), albumCover(album.id)]);
  const isRoot = album.id === share.album_id;
  return build({
    token,
    title: album.title,
    description: albumPreviewDescription({
      message: isRoot ? share.message : null,
      description: album.description,
      dates: albumDates(branch),
      photos: branch.photos,
    }),
    path: isRoot ? base : `${base}?album=${album.public_id}`,
    photo: cover,
  });
}

async function photoMetadata(share: ShareRow, token: string, photoPid: string): Promise<Metadata> {
  const photo = await getPhoto(photoPid);
  if (!photo || !(await shareCoversPhoto(share, photo.id))) return { title: SITE_NAME };
  return build({
    token,
    title: photoTitle(photo),
    description: photoDescription(share, photo),
    path: `/l/${token}/foto/${photo.public_id}`,
    photo,
  });
}

function photoDescription(share: ShareRow, photo: PhotoDetail): string {
  if (share.target_type === "photo" && share.message?.trim()) return clip(share.message);
  return photo.description?.trim() ? clip(photo.description) : "";
}
