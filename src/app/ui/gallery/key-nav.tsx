"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Frecce ← → per la foto precedente/successiva, Esc per tornare all'album. */
export function KeyNav({ prev, next, up }: { prev?: string | null; next?: string | null; up?: string | null }) {
  const router = useRouter();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key === "ArrowLeft" && prev) router.push(prev);
      else if (e.key === "ArrowRight" && next) router.push(next);
      else if (e.key === "Escape" && up) router.push(up);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, up, router]);
  return null;
}
