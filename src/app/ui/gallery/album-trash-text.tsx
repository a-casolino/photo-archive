"use client";

import { useEffect, useState } from "react";
import { albumTrashPreviewAction } from "@/app/actions/trash";
import { formatCount } from "@/lib/format";

type Preview = { only: number; elsewhere: number; subalbums: number };

/**
 * Spiegazione sotto "Elimina album": cosa va nel cestino. Il conto (foto che
 * stanno solo nell'album, sotto-album) si chiede al server solo quando la
 * finestra si apre, non a ogni apertura della pagina dell'album.
 */
export function AlbumTrashText({ albumId, retentionDays }: { albumId: string; retentionDays: number }) {
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    let live = true;
    albumTrashPreviewAction(albumId).then(
      (p) => live && setPreview(p),
      (e) => console.error("[cestino]", e),
    );
    return () => {
      live = false;
    };
  }, [albumId]);

  const p = preview;
  return (
    <p className="muted">
      L&apos;album va nel cestino
      {p && p.subalbums > 0
        ? ` con ${p.subalbums === 1 ? "il suo sotto-album" : `i suoi ${formatCount(p.subalbums)} sotto-album`}`
        : ""}
      {p && p.only > 0
        ? ` con ${p.only === 1 ? "la foto che sta" : `le ${formatCount(p.only)} foto che stanno`} solo ${p.subalbums > 0 ? "lì" : "qui"}`
        : ""}
      {p && p.elsewhere > 0
        ? `; ${p.elsewhere === 1 ? "la foto che è" : `le ${formatCount(p.elsewhere)} foto che sono`} anche in altri album ${p.elsewhere === 1 ? "resta" : "restano"} lì`
        : ""}
      {p ? "" : " (calcolo cosa contiene…)"}. Puoi ripristinarlo dal Cestino per {retentionDays} giorni, poi viene
      eliminato per sempre, file compresi.
    </p>
  );
}
