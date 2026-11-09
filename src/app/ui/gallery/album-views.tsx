import Link from "next/link";
import { LayoutGrid, List } from "lucide-react";
import { ViewSwitchButton } from "./view-switch";
import { ALBUM_VIEW_COOKIE, type AlbumView } from "./album-view-pref";

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
  /** Periodo e numero di foto. */
  detail: string;
  /** Origine dell'album (solo nella lista). */
  origin?: string;
};

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
              <strong>{a.title}</strong>
              <span>{[a.detail, a.origin].filter(Boolean).join(" · ")}</span>
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
