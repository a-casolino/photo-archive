import Link from "next/link";
import { cookies } from "next/headers";
import { undoTrashAction } from "@/app/actions/trash";
import { env } from "@/lib/env";
import { formatCount } from "@/lib/format";
import { decodeUndo, UNDO_COOKIE } from "@/lib/trash-rules";

/*
 * Messaggi dopo "Sposta nel cestino", "Elimina album" e "Togli dall'album",
 * con "Annulla" finché il cookie breve ricorda cosa è appena andato nel
 * cestino. `back` è la pagina senza i parametri del messaggio: ci si torna
 * dopo l'annullamento.
 */

type SP = Record<string, string | string[] | undefined>;

const num = (v: SP[string]): number | null => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);

async function undoKind(): Promise<"photos" | "albums" | null> {
  return decodeUndo((await cookies()).get(UNDO_COOKIE)?.value)?.kind ?? null;
}

function UndoButton({ back }: { back: string }) {
  return (
    <form action={undoTrashAction} className="undo-form">
      <input type="hidden" name="back" value={back} />
      <button type="submit" className="link">
        Annulla
      </button>
    </form>
  );
}

/** Dopo foto spostate nel cestino (?cestino), riportate (?ripristinate) o tolte dall'album (?tolte). */
export async function PhotoTrashNotice({ sp, back }: { sp: SP; back: string }) {
  const trashed = num(sp.cestino);
  const restored = num(sp.ripristinate);
  const removed = num(sp.tolte);
  const days = env().TRASH_RETENTION_DAYS;
  return (
    <>
      {trashed !== null && trashed > 0 && (
        <div className="msg msg-ok msg-undo" role="status">
          <span>
            {trashed === 1 ? "Foto spostata" : `${formatCount(trashed)} foto spostate`} nel{" "}
            <Link href="/admin/cestino">cestino</Link>: {trashed === 1 ? "si può ripristinare" : "si possono ripristinare"}{" "}
            per {days} giorni.
          </span>
          {(await undoKind()) === "photos" && <UndoButton back={back} />}
        </div>
      )}
      {restored !== null && (
        <p className="msg msg-ok" role="status">
          {restored === 0
            ? "Niente da annullare: le foto non sono più nel cestino."
            : `${restored === 1 ? "Foto tornata" : `${formatCount(restored)} foto tornate`} al loro posto.`}
        </p>
      )}
      {removed !== null && removed > 0 && (
        <p className="msg msg-ok" role="status">
          {removed === 1 ? "Foto tolta" : `${formatCount(removed)} foto tolte`} dall&apos;album: restano in{" "}
          <Link href="/foto">Foto</Link> e negli altri album.
        </p>
      )}
    </>
  );
}

/** Dopo "Elimina album" (?album_cestino=<foto>&sotto_album=<n>[&album_n=<album>]) o il suo annullamento. */
export async function AlbumTrashNotice({ sp, back }: { sp: SP; back: string }) {
  const photos = num(sp.album_cestino);
  const restored = num(sp.album_ripristinati);
  if (restored !== null) {
    return (
      <p className="msg msg-ok card" role="status">
        {restored === 0
          ? "Niente da annullare: l'album non è più nel cestino."
          : restored === 1
            ? "Album ripristinato, con i sotto-album e le foto che erano andati nel cestino con lui."
            : `${formatCount(restored)} album ripristinati, con i sotto-album e le foto che erano andati nel cestino con loro.`}
      </p>
    );
  }
  if (photos === null) return null;
  const subs = num(sp.sotto_album) ?? 0;
  const albums = Math.max(1, num(sp.album_n) ?? 1);
  const parts = [subs > 0 ? `${formatCount(subs)} sotto-album` : "", photos > 0 ? `${formatCount(photos)} foto` : ""].filter(
    Boolean,
  );
  return (
    <div className="msg msg-ok msg-undo card" role="status">
      <span>
        {albums === 1 ? "Album spostato" : `${formatCount(albums)} album spostati`} nel{" "}
        <Link href="/admin/cestino">cestino</Link>
        {parts.length ? ` con ${parts.join(" e ")}` : ""}: {albums === 1 ? "puoi ripristinarlo" : "puoi ripristinarli"} da
        lì.
      </span>
      {(await undoKind()) === "albums" && <UndoButton back={back} />}
    </div>
  );
}

/** Nel visore a schermo intero: "Foto spostata nel cestino · Annulla", dopo il cestino dal visore. */
export async function LightboxTrashNotice({ sp, back }: { sp: SP; back: string }) {
  const trashed = num(sp.cestino);
  if (!trashed || (await undoKind()) !== "photos") return null;
  return (
    <div className="lightbox-notice" role="status">
      <span>{trashed === 1 ? "Foto spostata" : `${formatCount(trashed)} foto spostate`} nel cestino</span>
      <form action={undoTrashAction}>
        <input type="hidden" name="back" value={back} />
        <button type="submit" className="lightbox-pill">
          Annulla
        </button>
      </form>
    </div>
  );
}
