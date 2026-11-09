"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type TouchEvent } from "react";
import { swipeDirection } from "@/lib/gallery-rules";

/**
 * Swipe a destra/sinistra sulla foto per la precedente/successiva (telefono).
 * La foto segue il dito; se il gesto è troppo corto torna al suo posto.
 * Non interferisce con lo scroll verticale né con lo zoom a due dita.
 * `replace`: la nuova foto prende il posto di quella attuale nella cronologia
 * (nel lightbox, così "Indietro" non ripercorre tutte le foto viste).
 */
export function SwipeNav({
  prev,
  next,
  replace,
  className,
  onClick,
  children,
}: {
  prev?: string | null;
  next?: string | null;
  replace?: boolean;
  className?: string;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const horizontal = useRef(false);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<"prev" | "next" | null>(null);

  // Le foto vicine si preparano subito, così lo swipe è immediato.
  useEffect(() => {
    if (prev) router.prefetch(prev);
    if (next) router.prefetch(next);
  }, [prev, next, router]);

  function zoomed() {
    return (window.visualViewport?.scale ?? 1) > 1.01;
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1 || zoomed()) {
      start.current = null;
      return;
    }
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, t: performance.now() };
    horizontal.current = false;
  }

  function onTouchMove(e: TouchEvent) {
    const s = start.current;
    if (!s || e.touches.length !== 1) return;
    const t = e.touches[0];
    const mx = t.clientX - s.x;
    const my = t.clientY - s.y;
    if (!horizontal.current) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      // Il primo movimento decide: verticale = scroll della pagina.
      if (Math.abs(my) > Math.abs(mx)) {
        start.current = null;
        return;
      }
      horizontal.current = true;
      setDragging(true);
    }
    // Ai bordi (nessuna foto da quella parte) la foto si muove poco.
    const blocked = (mx > 0 && !prev) || (mx < 0 && !next);
    setDx(blocked ? mx / 4 : mx);
  }

  function onTouchEnd(e: TouchEvent) {
    const s = start.current;
    start.current = null;
    setDragging(false);
    if (!s || !horizontal.current) return;
    const t = e.changedTouches[0];
    const dir = swipeDirection(t.clientX - s.x, t.clientY - s.y, performance.now() - s.t, window.innerWidth);
    const target = dir === "prev" ? prev : dir === "next" ? next : null;
    if (dir && target) {
      setLeaving(dir);
      if (replace) router.replace(target, { scroll: false });
      else router.push(target);
    } else {
      setDx(0);
    }
  }

  const offset = leaving ? (leaving === "prev" ? "100vw" : "-100vw") : `${dx}px`;
  return (
    <div
      className={className ? `swipe-area ${className}` : "swipe-area"}
      onClick={onClick}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        start.current = null;
        setDragging(false);
        setDx(0);
      }}
      style={{
        transform: `translateX(${offset})`,
        transition: dragging ? "none" : "transform 0.2s ease-out, opacity 0.2s",
        opacity: leaving ? 0 : 1,
      }}
    >
      {children}
    </div>
  );
}
