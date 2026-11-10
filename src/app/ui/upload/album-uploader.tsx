"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { UploadIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Phase } from "@/lib/upload/engine";
import { canKeepHandles } from "@/lib/upload/files";
import type { IntoAlbum } from "@/lib/upload/plan";
import { loadUpload } from "@/lib/upload/saved";
import { readDrop, Uploader, type Dropped } from "./uploader";

/*
 * Caricamento dentro l'album aperto: foto e cartelle trascinate sulla
 * pagina (o "Aggiungi foto") vanno in questo album, le cartelle diventano
 * suoi sotto-album. Solo per il proprietario (la pagina è sua).
 */

const OPEN_EVENT = "album-upload:open";

/** Pulsante "Aggiungi foto" tra le azioni dell'album: apre il pannello qui sotto. */
export function AddPhotosButton() {
  return (
    <Button variant="outline" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>
      <UploadIcon />
      Aggiungi foto
    </Button>
  );
}

export function AlbumUploader({
  album,
  ...props
}: {
  album: IntoAlbum;
  wasmUrl: string;
  recentBps: number | null;
  testStorage: boolean;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [dropped, setDropped] = useState<Dropped | null>(null);
  const [phase, setPhase] = useState<Phase>("empty");
  const busy = phase === "running" || phase === "paused";
  const scope = `album:${album.publicId}`;

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    // Un caricamento lasciato a metà in questo album: il pannello si apre con «Riprendi».
    let live = true;
    if (canKeepHandles()) {
      void loadUpload(scope).then((rec) => {
        if (live && rec) setOpen(true);
      });
    }
    return () => {
      live = false;
      window.removeEventListener(OPEN_EVENT, show);
    };
  }, [scope]);

  // File trascinati in qualunque punto della pagina.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e) || busy) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const dragOver = (e: DragEvent) => {
      if (hasFiles(e) && !busy) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setOver(false);
      // Già preso dal riquadro del pannello, o caricamento in corso.
      if (!hasFiles(e) || e.defaultPrevented || busy || !e.dataTransfer) return;
      e.preventDefault();
      setDropped(readDrop(e.dataTransfer));
      setOpen(true);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", dragOver);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", dragOver);
      window.removeEventListener("drop", drop);
    };
  }, [busy]);

  return (
    <>
      {over && !open && (
        <div className="album-drop-overlay" aria-hidden>
          Rilascia per aggiungere a «{album.title}»
        </div>
      )}
      {open && (
        <section className="album-upload" aria-label={`Aggiungi foto a ${album.title}`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-lg font-semibold">Aggiungi foto a «{album.title}»</h2>
            {!busy && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Chiudi"
                onClick={() => {
                  setOpen(false);
                  setDropped(null);
                  setPhase("empty");
                }}
              >
                <XIcon />
              </Button>
            )}
          </div>
          <Uploader
            {...props}
            scope={scope}
            into={album}
            dropped={dropped}
            onPhaseChange={setPhase}
            onFinished={() => router.refresh()}
          />
        </section>
      )}
    </>
  );
}
