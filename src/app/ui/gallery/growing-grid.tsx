"use client";

import type { ReactNode } from "react";
import { GrowingFoot } from "./growing-foot";
import { Masonry, type MasonryItem } from "./masonry";
import { useGrowing } from "./use-growing";

/*
 * Griglia di foto che arriva a blocchi mentre si scorre (vedi useGrowing):
 * album (/api/griglia, anche condivisioni e link) e pagina Foto
 * (/api/foto-elenco). Negli album le foto della sezione "Altri scatti"
 * vanno nella seconda griglia, sotto `extraHeading`.
 */
export function GrowingGrid({
  initial,
  total,
  endpoint = "/api/griglia",
  source,
  extraHeading,
  selectName,
}: {
  initial: MasonryItem[];
  /** Foto in tutto con il filtro scelto (tutte le sezioni). */
  total: number;
  endpoint?: "/api/griglia" | "/api/foto-elenco";
  /** Parametri della richiesta (album o filtri), senza da/n. */
  source: Record<string, string>;
  extraHeading?: ReactNode;
  selectName?: string;
}) {
  const g = useGrowing({ initial, endpoint, query: new URLSearchParams(source).toString(), total });
  const main = g.items.filter((i) => !i.extra);
  const extra = g.items.filter((i) => i.extra);
  return (
    <div onClickCapture={g.remember}>
      {main.length > 0 && <Masonry items={main} selectName={selectName} />}
      {extra.length > 0 && (
        <>
          {extraHeading}
          <Masonry items={extra} selectName={selectName} />
        </>
      )}
      {g.more && (
        <GrowingFoot
          sentinel={g.sentinel}
          loading={g.loading}
          failed={g.failed}
          retry={g.retry}
          label={`${g.items.length} di ${total} foto`}
        />
      )}
    </div>
  );
}
