import Link from "next/link";
import { LayoutGrid, List } from "lucide-react";
import { formatBytes, formatCount } from "@/lib/format";
import { ViewSwitchButton } from "./view-switch";
import { ALBUM_VIEW_COOKIE, type AlbumView } from "./album-view-pref";
import { albumDates } from "./dates";

/*
 * Elenco degli album in due vedute: griglia di copertine tutte uguali
 * (ritagliate in "cover") oppure lista, un album per riga con miniatura
 * piccola e titolo in evidenza. Dentro un album resta la masonry.
 */

export type AlbumEntry = {
  key: string;
  href: string;
  /** URL firmato della copertina, null se manca. */
  src: string | null;
  title: string;
  /** Album che lo contengono ("Viaggi › 2019"), nei risultati di una ricerca. */
  path?: string;
  /** Periodo, numero di foto, sotto-album ed eventualmente peso. */
  detail: string;
};

/**
 * "12 lug 2014 · 120 foto · 3 sotto-album · 2,3 GB" (foto comprese quelle dei
 * sotto-album). Il peso degli originali solo con `withSize`, cioè per il
 * proprietario.
 */
export function albumDetail(
  a: {
    date_from: Date | null;
    date_to: Date | null;
    photo_count: number;
    child_count: number;
    total_bytes: number;
  },
  { withSize = false }: { withSize?: boolean } = {},
): string {
  return [
    albumDates(a),
    `${formatCount(a.photo_count)} foto`,
    a.child_count > 0 ? `${formatCount(a.child_count)} sotto-album` : "",
    withSize && a.photo_count > 0 ? formatBytes(a.total_bytes) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function AlbumViewSwitch({ view }: { view: AlbumView }) {
  return (
    <div className="view-switch" role="group" aria-label="Visualizzazione">
      <ViewSwitchButton cookie={ALBUM_VIEW_COOKIE} value="griglia" active={view === "griglia"} label="Griglia">
        <LayoutGrid aria-hidden size={18} />
      </ViewSwitchButton>
      <ViewSwitchButton cookie={ALBUM_VIEW_COOKIE} value="lista" active={view === "lista"} label="Lista">
        <List aria-hidden size={18} />
      </ViewSwitchButton>
    </div>
  );
}

export function AlbumGrid({ albums }: { albums: AlbumEntry[] }) {
  return (
    <ul className="album-grid">
      {albums.map((a) => (
        <li key={a.key}>
          <Link href={a.href} className="album-card" prefetch={false}>
            <Cover src={a.src} />
            <span className="album-card-text">
              {a.path && <span className="album-path">{a.path}</span>}
              <strong>{a.title}</strong>
              {a.detail && <span>{a.detail}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AlbumList({ albums }: { albums: AlbumEntry[] }) {
  return (
    <ul className="album-list">
      {albums.map((a) => (
        <li key={a.key}>
          <Link href={a.href} className="album-row" prefetch={false}>
            <Cover src={a.src} />
            <span className="album-row-text">
              {a.path && <span className="album-path">{a.path}</span>}
              <strong>{a.title}</strong>
              {a.detail && <span>{a.detail}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Cover({ src }: { src: string | null }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- URL firmati temporanei, niente ottimizzazione
    <img className="album-cover" src={src} alt="" loading="lazy" decoding="async" />
  ) : (
    <span className="album-cover album-cover-empty">senza anteprima</span>
  );
}
