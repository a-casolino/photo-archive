"use client";

import type { RefObject } from "react";

/** Fondo di un elenco che si allunga: punto di aggancio, stato e "riprova". */
export function GrowingFoot({
  sentinel,
  loading,
  failed,
  retry,
  label,
}: {
  sentinel: RefObject<HTMLDivElement | null>;
  loading: boolean;
  failed: boolean;
  retry: () => void;
  /** Testo quando non sta caricando ("60 di 340 foto"). */
  label?: string;
}) {
  return (
    <div ref={sentinel} className="grid-more" aria-live="polite">
      {failed ? (
        <button type="button" className="link" onClick={retry}>
          Caricamento non riuscito: riprova
        </button>
      ) : (
        <span className="muted">{loading ? "Carico gli altri…" : (label ?? "")}</span>
      )}
    </div>
  );
}
