"use client";

import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { LIGHTBOX_PARAM, withQueryParam } from "@/lib/gallery-rules";
import { SwipeNav } from "./swipe-nav";

/*
 * Foto della pagina che, al click, si apre a schermo intero su sfondo nero
 * trasparente. Dentro: swipe e frecce (← →) per le foto vicine dell'album,
 * Esc, X o un tocco fuori dalla foto per chiudere.
 *
 * Lo stato "aperto" sta nell'URL (?schermo=1): passando alla foto successiva
 * il server disegna la nuova pagina con il lightbox già aperto, e il link si
 * può ricaricare o condividere. Aprire e chiudere usano la History API, quindi
 * non c'è nessuna richiesta al server (e l'anteprima non si ricarica).
 */
export function PhotoLightbox({
  src,
  alt,
  filename,
  width,
  height,
  prev,
  next,
  position,
  actions,
  notice,
}: {
  src: string;
  alt: string;
  filename: string;
  width?: number;
  height?: number;
  prev?: string | null;
  next?: string | null;
  position?: string;
  /** Pulsanti in più nella barra in alto, prima di "Chiudi" (es. cestino). */
  actions?: ReactNode;
  /** Avviso in basso, sopra il nome del file (es. "Foto spostata nel cestino · Annulla"). */
  notice?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.has(LIGHTBOX_PARAM);
  // Aperto con un click in questa pagina: chiudere = tornare indietro nella cronologia.
  const openedHere = useRef(false);

  const here = () => `${pathname}${window.location.search}`;
  const lbPrev = prev ? withQueryParam(prev, LIGHTBOX_PARAM, "1") : null;
  const lbNext = next ? withQueryParam(next, LIGHTBOX_PARAM, "1") : null;

  function show() {
    openedHere.current = true;
    window.history.pushState(null, "", withQueryParam(here(), LIGHTBOX_PARAM, "1"));
  }

  function close() {
    if (openedHere.current) {
      openedHere.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, "", withQueryParam(here(), LIGHTBOX_PARAM, null));
    }
  }

  function go(target: string | null) {
    if (target) router.replace(target, { scroll: false });
  }

  // Tastiera nel lightbox. In cattura, così la navigazione della pagina
  // (KeyNav: Esc = torna all'album) non riceve gli stessi tasti.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key === "ArrowLeft") {
        if (lbPrev) router.replace(lbPrev, { scroll: false });
      } else if (e.key === "ArrowRight") {
        if (lbNext) router.replace(lbNext, { scroll: false });
      } else if (e.key === "Escape") {
        close();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close() legge solo ref e URL correnti
  }, [open, lbPrev, lbNext, router]);

  // Un tocco sullo sfondo (non sulla foto né sui pulsanti) chiude.
  function onBackdrop(e: MouseEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    if (!t.closest("img, button, a")) close();
  }

  return (
    <>
      {/* Il Dialog sta fuori da questo SwipeNav: gli eventi del portale risalgono
          l'albero React e altrimenti arriverebbero anche alla foto della pagina. */}
      <SwipeNav prev={prev} next={next}>
        <button type="button" className="photo-open" onClick={show} aria-label="Apri a schermo intero">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL firmati temporanei, niente ottimizzazione */}
          <img src={src} alt={alt} width={width} height={height} className="photo-preview" />
        </button>
      </SwipeNav>

      <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && close()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="lightbox-overlay" />
          <DialogPrimitive.Content
            className="lightbox"
            aria-describedby={undefined}
            onEscapeKeyDown={(e) => e.preventDefault()}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <DialogPrimitive.Title className="sr-only">{alt}</DialogPrimitive.Title>

            <SwipeNav key={src} prev={lbPrev} next={lbNext} replace className="lightbox-stage" onClick={onBackdrop}>
              {/* eslint-disable-next-line @next/next/no-img-element -- URL firmati temporanei, niente ottimizzazione */}
              <img src={src} alt={alt} width={width} height={height} className="lightbox-img" draggable={false} />
            </SwipeNav>

            <div className="lightbox-top">
              <span>{position}</span>
              <div className="lightbox-actions">
                {actions}
                <button type="button" className="lightbox-btn" onClick={close} aria-label="Chiudi" title="Chiudi (Esc)">
                  <XIcon />
                </button>
              </div>
            </div>

            {lbPrev && (
              <button
                type="button"
                className="lightbox-btn lightbox-nav prev"
                onClick={() => go(lbPrev)}
                aria-label="Foto precedente"
                title="Precedente (←)"
              >
                <ChevronLeftIcon />
              </button>
            )}
            {lbNext && (
              <button
                type="button"
                className="lightbox-btn lightbox-nav next"
                onClick={() => go(lbNext)}
                aria-label="Foto successiva"
                title="Successiva (→)"
              >
                <ChevronRightIcon />
              </button>
            )}

            {notice}
            <p className="lightbox-name">{filename}</p>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
