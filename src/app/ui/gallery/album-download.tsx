import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";

/*
 * "Scarica tutte": scarica l'album (con i sotto-album) in un file ZIP di
 * JPEG grandi. `source` dice da dove si arriva, come per la presentazione:
 * { album } per il proprietario, { s } per una condivisione protetta,
 * { t } per un link libero, più l'eventuale sotto-album aperto ({ album }).
 * Se mostrarlo lo decide chi lo usa (permesso di download già controllato);
 * il server ricontrolla tutto in /api/download/album.
 */
export function AlbumDownloadButton({
  source,
  photos,
}: {
  source: { album?: string; s?: string; t?: string };
  photos: number;
}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(source)) if (v) q.set(k, v);
  const label = photos === 1 ? "una foto" : `${formatCount(photos)} foto`;
  return (
    <Button asChild variant="outline">
      <a href={`/api/download/album?${q}`} download title={`Un file ZIP con ${label} in JPEG`}>
        <DownloadIcon />
        Scarica tutte
      </a>
    </Button>
  );
}
