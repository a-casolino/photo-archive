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
export function Masonry({ items, minColumns = 2 }: { items: MasonryItem[]; minColumns?: number }) {
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
              <Link key={it.key} href={it.href} className="tile" prefetch={false}>
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
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}
