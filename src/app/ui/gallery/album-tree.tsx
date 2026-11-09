import Link from "next/link";
import { FolderInputIcon, FolderPlusIcon } from "lucide-react";
import { createAlbumAction, moveAlbumAction } from "@/app/actions/albums";
import { ActionForm } from "@/app/ui/action-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MAX_ALBUM_DEPTH, PATH_SEP } from "@/lib/album-tree-rules";

/*
 * Pezzi d'interfaccia dei sotto-album (solo proprietario): percorso,
 * "Nuovo album" / "Nuovo sotto-album", "Sposta in…" e il messaggio dopo
 * "Elimina album".
 */

type Node = { id: number; public_id: string; title: string; parent_id: number | null };

/** Album che contengono `id`, dal primo livello ("Viaggi › 2019"); vuoto se è al primo livello. */
export function parentsLabel(id: number, byId: Map<number, Node>): string {
  const titles: string[] = [];
  let cur = byId.get(id)?.parent_id ?? null;
  while (cur !== null && titles.length < MAX_ALBUM_DEPTH) {
    const n = byId.get(cur);
    if (!n) break;
    titles.unshift(n.title);
    cur = n.parent_id;
  }
  return titles.join(PATH_SEP);
}

export function NewAlbumDialog({ parent }: { parent?: { publicId: string; title: string } }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FolderPlusIcon />
          {parent ? "Nuovo sotto-album" : "Nuovo album"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{parent ? `Nuovo sotto-album in «${parent.title}»` : "Nuovo album"}</DialogTitle>
          <DialogDescription>
            {parent
              ? "Chi ha ricevuto questo album vedrà anche il nuovo sotto-album."
              : "Un album vuoto: poi puoi spostarci dentro altri album con «Sposta in…»."}
          </DialogDescription>
        </DialogHeader>
        <ActionForm action={createAlbumAction} submitLabel="Crea">
          {parent && <input type="hidden" name="parent" value={parent.publicId} />}
          <label>
            Titolo
            <input name="title" required maxLength={255} autoComplete="off" />
          </label>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export type MoveOption = { publicId: string; label: string; shared: boolean };

/**
 * "Sposta in…": le destinazioni possibili (già filtrate: niente cicli e al
 * massimo 3 livelli), con il percorso e un avviso per quelle condivise.
 */
export function MoveAlbumDialog({
  album,
  options,
  atTop,
}: {
  album: { publicId: string; title: string };
  options: MoveOption[];
  /** L'album è già al primo livello (l'opzione "Primo livello" non serve). */
  atTop: boolean;
}) {
  if (!options.length && atTop) return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FolderInputIcon />
          Sposta in…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sposta «{album.title}»</DialogTitle>
          <DialogDescription>
            I sotto-album si spostano con lui. Al massimo {MAX_ALBUM_DEPTH} livelli: le destinazioni che li
            supererebbero non sono in elenco. Se lo metti in un album condiviso, chi ha ricevuto quell&apos;album lo
            vedrà.
          </DialogDescription>
        </DialogHeader>
        <ActionForm action={moveAlbumAction} submitLabel="Sposta">
          <input type="hidden" name="albumId" value={album.publicId} />
          <label>
            Dentro
            <select name="parent" defaultValue={atTop ? (options[0]?.publicId ?? "") : ""} required={atTop}>
              {!atTop && <option value="">Nessun album (primo livello)</option>}
              {options.map((o) => (
                <option key={o.publicId} value={o.publicId}>
                  {o.label}
                  {o.shared ? " (condiviso)" : ""}
                </option>
              ))}
            </select>
          </label>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

/** Messaggio dopo "Elimina album" (?album_cestino=<foto>&sotto_album=<n>). */
export function AlbumTrashedMsg({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const photos = typeof sp.album_cestino === "string" && /^\d+$/.test(sp.album_cestino) ? Number(sp.album_cestino) : null;
  if (photos === null) return null;
  const subs = typeof sp.sotto_album === "string" && /^\d+$/.test(sp.sotto_album) ? Number(sp.sotto_album) : 0;
  const parts = [subs > 0 ? `${subs} sotto-album` : "", photos > 0 ? `${photos} foto` : ""].filter(Boolean);
  return (
    <p className="msg msg-ok card" role="status">
      Album spostato nel <Link href="/admin/cestino">cestino</Link>
      {parts.length ? ` con ${parts.join(" e ")}` : ""}: puoi ripristinarlo da lì.
    </p>
  );
}
