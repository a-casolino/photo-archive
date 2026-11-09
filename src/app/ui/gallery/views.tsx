import Link from "next/link";
import type { ReactNode } from "react";
import { formatBytes, formatTakenAt } from "@/lib/format";
import { cameraLabel, displaySize, exposureLabel } from "@/lib/gallery-rules";
import type { PhotoCard, PhotoDetail } from "@/lib/gallery";
import { canDownload, type DownloadLevel } from "@/lib/roles";
import { KeyNav } from "./key-nav";
import { PhotoLightbox } from "./lightbox";
import { SwipeNav } from "./swipe-nav";
import type { MasonryItem } from "./masonry";

/*
 * Pezzi comuni alle gallerie del proprietario, delle condivisioni protette
 * e dei link liberi. I permessi li decide sempre il server: qui arrivano
 * già calcolati (livello di download, URL firmati).
 */

export const PAGE_SIZE = 200;

/** Come si raggiunge il download: proprietario, condivisione protetta o link libero. */
export type DownloadAccess = { share?: string; token?: string };

export function downloadHref(photoPid: string, v: "preview" | "original", access: DownloadAccess): string {
  const q = new URLSearchParams({ p: photoPid, v });
  if (access.share) q.set("s", access.share);
  if (access.token) q.set("t", access.token);
  return `/api/download?${q}`;
}

export function photoTitle(p: Pick<PhotoCard, "title" | "original_filename">): string {
  return p.title || p.original_filename;
}

export function ratioOf(p: Pick<PhotoCard, "width" | "height" | "orientation">): number | null {
  const size = displaySize(p.width, p.height, p.orientation);
  return size ? size.height / size.width : null;
}

export function photoItems(
  cards: PhotoCard[],
  urls: Map<string, string>,
  hrefFor: (pid: string) => string,
  opts: { badges?: boolean } = {},
): MasonryItem[] {
  return cards.map((p) => ({
    key: p.public_id,
    href: hrefFor(p.public_id),
    src: p.thumb_key ? (urls.get(p.thumb_key) ?? null) : null,
    alt: photoTitle(p),
    ratio: ratioOf(p),
    badge: opts.badges && p.edited ? "Lightroom" : undefined,
  }));
}

/** Link "Tutte / Solo con regolazioni" dell'album. */
export function EditedFilter({
  base,
  onlyEdited,
  total,
  edited,
}: {
  base: string;
  onlyEdited: boolean;
  total: number;
  edited: number;
}) {
  if (!edited) return null;
  return (
    <nav className="filter-tabs" aria-label="Filtro">
      <Link href={base} className={onlyEdited ? undefined : "active"} aria-current={onlyEdited ? undefined : "page"}>
        Tutte ({total})
      </Link>
      <Link
        href={`${base}${base.includes("?") ? "&" : "?"}solo=regolazioni`}
        className={onlyEdited ? "active" : undefined}
        aria-current={onlyEdited ? "page" : undefined}
      >
        Solo con regolazioni ({edited})
      </Link>
    </nav>
  );
}

export function Pager({ base, page, total, query }: { base: string; page: number; total: number; query?: string }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  const href = (n: number) => {
    const q = new URLSearchParams(query);
    if (n > 1) q.set("pagina", String(n));
    else q.delete("pagina");
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  return (
    <nav className="pager" aria-label="Pagine">
      {page > 1 ? <Link href={href(page - 1)}>← Precedenti</Link> : <span />}
      <span className="muted">
        Pagina {page} di {pages}
      </span>
      {page < pages ? <Link href={href(page + 1)}>Successive →</Link> : <span />}
    </nav>
  );
}

export function parsePage(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * Pagina di una foto: anteprima grande, frecce, informazioni e download.
 * `showPrivate`: dati riservati al proprietario (posizione GPS, file).
 */
export function PhotoView({
  photo,
  previewUrl,
  nav,
  level,
  access,
  showPrivate,
  children,
}: {
  photo: PhotoDetail;
  previewUrl: string | null;
  nav: { prev?: string | null; next?: string | null; up?: string | null; upLabel?: string; position?: string };
  level: DownloadLevel;
  access: DownloadAccess;
  showPrivate: boolean;
  children?: ReactNode;
}) {
  const size = displaySize(photo.width, photo.height, photo.orientation);
  const camera = photo.camera_name || cameraLabel(photo.camera_make, photo.camera_model);
  const exposure = exposureLabel(photo);
  const title = photoTitle(photo);
  const isRaw = photo.mime_type === "image/x-canon-cr2" || photo.kind === "raw";

  return (
    <div className="photo-page">
      <KeyNav prev={nav.prev} next={nav.next} up={nav.up} />
      <div className="photo-top">
        {nav.up ? <Link href={nav.up}>← {nav.upLabel ?? "Indietro"}</Link> : <span />}
        {nav.position && <span className="muted">{nav.position}</span>}
      </div>

      <div className="photo-stage">
        {nav.prev ? (
          <Link href={nav.prev} className="stage-nav prev" aria-label="Foto precedente" title="Precedente (←)">
            ‹
          </Link>
        ) : (
          <span className="stage-nav" />
        )}
        {previewUrl ? (
          <PhotoLightbox
            key={photo.public_id}
            src={previewUrl}
            alt={title}
            filename={photo.original_filename}
            width={size?.width}
            height={size?.height}
            prev={nav.prev}
            next={nav.next}
            position={nav.position}
          />
        ) : (
          <SwipeNav key={photo.public_id} prev={nav.prev} next={nav.next}>
            <div className="photo-preview tile-empty">Anteprima non disponibile</div>
          </SwipeNav>
        )}
        {nav.next ? (
          <Link href={nav.next} className="stage-nav next" aria-label="Foto successiva" title="Successiva (→)">
            ›
          </Link>
        ) : (
          <span className="stage-nav" />
        )}
      </div>

      <div className="photo-info">
        <section>
          {/* Niente titolo visibile: il nome del file è già tra i dati sotto (File). */}
          {photo.description && <p>{photo.description}</p>}
          {photo.edited ? <p className="muted">Versione con le regolazioni di Lightroom.</p> : null}
          <dl className="exif">
            {photo.title && photo.title !== photo.original_filename && (
              <>
                <dt>Titolo</dt>
                <dd>{photo.title}</dd>
              </>
            )}
            <dt>Data</dt>
            <dd>{formatTakenAt(photo.taken_at)}</dd>
            {camera && (
              <>
                <dt>Fotocamera</dt>
                <dd>{camera}</dd>
              </>
            )}
            {photo.lens && (
              <>
                <dt>Obiettivo</dt>
                <dd>{photo.lens}</dd>
              </>
            )}
            {exposure.length > 0 && (
              <>
                <dt>Scatto</dt>
                <dd>{exposure.join(" · ")}</dd>
              </>
            )}
            {size && (
              <>
                <dt>Dimensioni</dt>
                <dd>
                  {size.width} × {size.height} px
                </dd>
              </>
            )}
            {showPrivate && (
              <>
                <dt>File</dt>
                <dd>
                  {photo.original_filename} · {formatBytes(photo.file_size)}
                </dd>
              </>
            )}
            {showPrivate && photo.gps_lat !== null && photo.gps_lon !== null && (
              <>
                <dt>Posizione</dt>
                <dd>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${photo.gps_lat}&mlon=${photo.gps_lon}#map=15/${photo.gps_lat}/${photo.gps_lon}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {Number(photo.gps_lat).toFixed(5)}, {Number(photo.gps_lon).toFixed(5)}
                  </a>
                </dd>
              </>
            )}
          </dl>
        </section>

        {(canDownload(level, "preview") && photo.preview_key) || canDownload(level, "original") ? (
          <section className="downloads">
            {canDownload(level, "preview") && photo.preview_key && (
              <a className="button" href={downloadHref(photo.public_id, "preview", access)}>
                Scarica JPEG
              </a>
            )}
            {canDownload(level, "original") && (
              <a className="button secondary" href={downloadHref(photo.public_id, "original", access)}>
                Scarica originale{isRaw ? " (CR2)" : ""} · {formatBytes(photo.file_size)}
              </a>
            )}
          </section>
        ) : null}

        {children}
      </div>
    </div>
  );
}
