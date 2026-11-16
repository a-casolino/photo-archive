"use client";

import { useEffect } from "react";

/**
 * Scarica in anticipo le anteprime della foto precedente e successiva, dopo
 * che la pagina ha finito di caricarsi: con le frecce o lo swipe la foto
 * dopo è già nella cache del browser (gli URL firmati restano uguali per
 * un'ora, quindi la pagina successiva usa lo stesso indirizzo).
 */
export function PreloadImages({ urls }: { urls: (string | null | undefined)[] }) {
  const key = urls.filter(Boolean).join("\n");
  useEffect(() => {
    if (!key) return;
    const start = () => {
      for (const u of key.split("\n")) {
        const img = new Image();
        img.decoding = "async";
        img.src = u;
      }
    };
    if (document.readyState === "complete") {
      const t = setTimeout(start, 300);
      return () => clearTimeout(t);
    }
    window.addEventListener("load", start, { once: true });
    return () => window.removeEventListener("load", start);
  }, [key]);
  return null;
}
