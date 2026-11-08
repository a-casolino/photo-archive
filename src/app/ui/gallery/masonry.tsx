"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { columnsForWidth, masonryColumns } from "@/lib/gallery-rules";

export type MasonryItem = {
  key: string;
  href: string;
  /** URL firmato della miniatura, null se manca. */
  src: string | null;
  alt: string;
  /** altezza / larghezza; null se non si conosce. */
  ratio: number | null;
  badge?: string;
  caption?: { title: string; detail?: string };
};

/**
 * Griglia "masonry" senza ritaglio: ogni foto mantiene le sue proporzioni.
 * Le foto vanno nella colonna più bassa, così l'ordine (per data) si legge
 * da sinistra a destra. Il numero di colonne segue la larghezza.
 */
export function Masonry({
  items,
  minColumns = 2,
  selectName,
}: {
  items: MasonryItem[];
  minColumns?: number;
  /**
   * Modalità selezione: ogni foto ha una casella `name={selectName}` con
   * valore `key`, da inviare con il form che contiene la griglia, e non è
   * più un link.
   */
  selectName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(3);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (w: number) => setCols(Math.max(minColumns, columnsForWidth(w)));
    update(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => update(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [minColumns]);

  const layout = useMemo(() => masonryColumns(items.map((i) => i.ratio ?? 1), cols), [items, cols]);

  return (
    <div ref={ref} className="masonry" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {layout.map((col, c) => (
        <div key={c} className="masonry-col">
          {col.map((i) => {
            const it = items[i];
            const aspect = it.ratio ? `${1 / it.ratio}` : undefined;
            return (
              <Tile key={it.key} href={it.href} selectName={selectName} value={it.key}>
                {it.src ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL firmati temporanei, niente ottimizzazione
                  <img src={it.src} alt={it.alt} loading="lazy" decoding="async" style={{ aspectRatio: aspect }} />
                ) : (
                  <span className="tile-empty" style={{ aspectRatio: aspect ?? "4 / 3" }}>
                    senza anteprima
                  </span>
                )}
                {it.badge && <span className="tile-badge">{it.badge}</span>}
                {it.caption && (
                  <span className="tile-caption">
                    <strong>{it.caption.title}</strong>
                    {it.caption.detail && <span>{it.caption.detail}</span>}
                  </span>
                )}
              </Tile>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Tile({
  href,
  selectName,
  value,
  children,
}: {
  href: string;
  selectName?: string;
  value: string;
  children: React.ReactNode;
}) {
  if (!selectName) {
    return (
      <Link href={href} className="tile" prefetch={false}>
        {children}
      </Link>
    );
  }
  return (
    <label className="tile tile-pick">
      <input type="checkbox" name={selectName} value={value} />
      {children}
    </label>
  );
}
