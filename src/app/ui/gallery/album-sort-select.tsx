"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ALBUM_SORT_COOKIE, ALBUM_SORT_LABEL, ALBUM_SORTS, type AlbumSort } from "@/lib/album-sort";

/**
 * Menu "Ordina": salva la scelta in un cookie (un anno) e ricarica la pagina
 * dal server, che legge il cookie e ordina l'elenco. Vale per tutte le visite.
 */
export function AlbumSortSelect({ sort }: { sort: AlbumSort }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <select
      className="album-sort"
      aria-label="Ordina album"
      title="Ordina album"
      value={sort}
      disabled={pending}
      onChange={(e) => {
        document.cookie = `${ALBUM_SORT_COOKIE}=${encodeURIComponent(e.target.value)}; path=/; max-age=31536000; samesite=lax`;
        startTransition(() => router.refresh());
      }}
    >
      {ALBUM_SORTS.map((s) => (
        <option key={s} value={s}>
          {ALBUM_SORT_LABEL[s]}
        </option>
      ))}
    </select>
  );
}
