"use client";

import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { trashPhotosAction } from "@/app/actions/trash";

/*
 * Cestino nel visore a schermo intero (solo proprietario). Un tocco per
 * sbaglio è facile, quindi chiede conferma; dopo si passa alla foto
 * successiva con il visore ancora aperto (`back`).
 */
export function LightboxTrash({ photoId, back, withExport }: { photoId: string; back: string; withExport: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        className="lightbox-btn"
        onClick={() => setAsking(true)}
        aria-label="Sposta nel cestino"
        title="Sposta nel cestino"
      >
        <Trash2Icon />
      </button>
    );
  }
  return (
    <form action={trashPhotosAction} className="lightbox-confirm">
      <input type="hidden" name="photo" value={photoId} />
      <input type="hidden" name="back" value={back} />
      <span>{withExport ? "Nel cestino, con l'export collegato?" : "Spostare nel cestino?"}</span>
      <button type="submit" className="lightbox-pill danger" autoFocus>
        Sì
      </button>
      <button type="button" className="lightbox-pill" onClick={() => setAsking(false)}>
        No
      </button>
    </form>
  );
}
