import Link from "next/link";
import { purgePhotosAction, restorePhotosAction } from "@/app/actions/trash";
import { Masonry } from "@/app/ui/gallery/masonry";
import { ConfirmButton, SelectBar } from "@/app/ui/gallery/select-bar";
import { photoItems } from "@/app/ui/gallery/views";
import { env } from "@/lib/env";
import { formatBytes, formatCount } from "@/lib/format";
import { signKeys } from "@/lib/gallery";
import { requireOwner } from "@/lib/session";
import { listTrash, trashSummary } from "@/lib/trash";
import { purgeMessage } from "@/lib/trash-rules";

export default async function TrashPage({ searchParams }: PageProps<"/admin/cestino">) {
  await requireOwner();
  const sp = await searchParams;
  const days = env().TRASH_RETENTION_DAYS;
  const [items, summary] = await Promise.all([listTrash(days), trashSummary()]);
  const urls = await signKeys(items.map((p) => p.thumb_key));

  const tiles = photoItems(items, urls, (pid) => `/admin/cestino#${pid}`).map((tile, i) => {
    const left = Number(items[i].days_left);
    return {
      ...tile,
      caption: {
        title: tile.alt,
        detail: `${formatBytes(Number(items[i].total_size))} · ${left ? `si elimina tra ${left} giorn${left === 1 ? "o" : "i"}` : "si elimina alla prossima pulizia"}`,
      },
    };
  });

  const num = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
  const deleted = num(sp.eliminate);
  const failed = num(sp.errori) ?? 0;
  const restored = num(sp.ripristinate);

  return (
    <>
      <p>
        <Link href="/album" prefetch={false}>
          ← Album
        </Link>
      </p>
      <div className="page-head">
        <div>
          <h1>Cestino</h1>
          <p className="muted">
            {formatCount(summary.photos)} file · {formatBytes(summary.bytes)}. Le foto restano qui {days} giorni, poi
            vengono eliminate per sempre, file compresi. Puoi ripristinarle o eliminarle prima.
          </p>
        </div>
      </div>

      {deleted !== null && (
        <p className={failed ? "msg msg-error" : "msg msg-ok"} role="status">
          {purgeMessage(deleted, failed)}
        </p>
      )}
      {restored !== null && (
        <p className="msg msg-ok" role="status">
          Ripristinat{restored === 1 ? "a" : "e"} {restored} foto: sono di nuovo nei loro album.
        </p>
      )}
      {sp.errore === "conferma" && (
        <p className="msg msg-error" role="alert">
          Per eliminare definitivamente spunta la conferma.
        </p>
      )}

      {items.length === 0 ? (
        <p className="muted">Il cestino è vuoto.</p>
      ) : (
        <>
          <form>
            <SelectBar name="photo">
              <button type="submit" formAction={restorePhotosAction}>
                Ripristina
              </button>
              <ConfirmButton
                formAction={purgePhotosAction}
                label="Elimina definitivamente"
                confirmLabel="Non si può annullare"
              />
            </SelectBar>
            <Masonry items={tiles} selectName="photo" />
          </form>

          <details className="card owner-tools">
            <summary>Svuota il cestino</summary>
            <form action={purgePhotosAction} className="form">
              <p>
                Elimina per sempre tutte le foto nel cestino ({formatCount(summary.photos)} file,{" "}
                {formatBytes(summary.bytes)}): originali e anteprime vengono cancellati dal bucket, insieme a volti,
                tag e condivisioni delle singole foto.
              </p>
              {summary.archiveBytes > 0 && (
                <p className="muted">
                  I CR2 sono in classe Archive, che su Google Cloud ha una durata minima di 365 giorni: cancellarli
                  prima di un anno dall&apos;upload costa comunque i mesi mancanti (pochi centesimi al GB).
                </p>
              )}
              <input type="hidden" name="tutto" value="si" />
              <ConfirmButton formAction={purgePhotosAction} label="Svuota cestino" confirmLabel="Non si può annullare" />
            </form>
          </details>
        </>
      )}
    </>
  );
}
