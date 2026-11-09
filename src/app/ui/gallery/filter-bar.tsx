"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

/*
 * Barra di ricerca e filtri di Album e Foto: un <form> in GET.
 * Sul computer i campi stanno tutti in riga, come prima. Sul telefono resta
 * visibile solo la ricerca con il pulsante «Filtri» (con il numero di filtri
 * attivi); il pannello si apre sotto, con i campi ordinati in colonna.
 */
export function FilterBar({
  search,
  children,
  active,
  resetHref,
}: {
  /** Il campo di ricerca, sempre visibile. */
  search: ReactNode;
  /** I campi dei filtri (select, checkbox). */
  children: ReactNode;
  /** I filtri attivi, esclusa la ricerca, in parole ("2019", "#mare"…). */
  active: string[];
  /** Dove porta «Azzera»; senza, il pulsante non compare. */
  resetHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const activeCount = active.length;

  return (
    <form className="filter-bar" role="search" data-open={open || undefined}>
      <div className="filter-bar-search">
        {search}
        <Button
          type="button"
          variant="outline"
          className="filters-toggle h-auto min-[641px]:hidden"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          <SlidersHorizontal aria-hidden />
          Filtri
          {activeCount > 0 && (
            <span className="filters-count" aria-label={`${activeCount} attivi`}>
              {activeCount}
            </span>
          )}
        </Button>
      </div>
      {activeCount > 0 && (
        <p className="filter-summary">
          {active.map((label) => (
            <span key={label} className="filter-chip">
              {label}
            </span>
          ))}
          {resetHref && (
            <Link href={resetHref} className="filter-summary-reset">
              Azzera
            </Link>
          )}
        </p>
      )}
      <div className="filter-panel" id={panelId}>
        <div className="filter-fields">{children}</div>
        <div className="filter-actions">
          <button type="submit">Filtra</button>
          {resetHref && (
            <Link className="button secondary" href={resetHref}>
              Azzera
            </Link>
          )}
        </div>
      </div>
    </form>
  );
}
