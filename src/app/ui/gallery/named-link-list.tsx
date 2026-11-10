import Link from "next/link";
import { deleteNamedLink, setNamedLinkEnabled } from "@/app/actions/links";
import { Button } from "@/components/ui/button";
import { dateTimeFmt } from "@/lib/format";
import { listNamedLinks, type NamedLinkItem } from "@/lib/named-links";
import { CopyField } from "./copy-field";
import { NamedLinkCreateForm, NamedLinkEditForm, PointHereForm, type TargetOption } from "./named-link-forms";
import { DOWNLOAD_LABEL } from "./share-list";

/*
 * Link con nome (/l/<nome>), solo proprietario: l'elenco della pagina Link
 * e il riquadro nella finestra Condividi di album e foto.
 */

type LinkState = "active" | "disabled" | "trashed" | "empty";

const STATE_LABEL: Record<LinkState, string> = {
  active: "Attivo",
  disabled: "Disattivato",
  trashed: "Destinazione nel cestino",
  empty: "Senza destinazione",
};

function linkState(l: NamedLinkItem): LinkState {
  if (l.disabled_at) return "disabled";
  if (!l.target_type) return "empty";
  if (l.target_trashed) return "trashed";
  return "active";
}

function targetHref(l: NamedLinkItem): string | null {
  if (!l.target_public_id || l.target_trashed) return null;
  return `/${l.target_type === "album" ? "album" : "foto"}/${l.target_public_id}`;
}

function TargetLabel({ l }: { l: NamedLinkItem }) {
  if (!l.target_type) return <span className="muted">non punta a nulla</span>;
  const href = targetHref(l);
  const kind = l.target_type === "album" ? "album" : "foto";
  return (
    <>
      {href ? <Link href={href}>{l.target_title}</Link> : l.target_title}
      <span className="muted"> · {kind}</span>
    </>
  );
}

function Meta({ l }: { l: NamedLinkItem }) {
  return (
    <p className="share-meta muted">
      {DOWNLOAD_LABEL[l.allow_download]}
      {" · "}punta qui dal {dateTimeFmt.format(l.pointed_at)}
      {" · "}
      {l.view_count === 1 ? "1 visita" : `${l.view_count} visite`}
      {l.last_viewed_at && <> (ultima {dateTimeFmt.format(l.last_viewed_at)})</>}
    </p>
  );
}

function EnableForm({ l, back }: { l: NamedLinkItem; back?: string }) {
  const enable = Boolean(l.disabled_at);
  return (
    <form action={setNamedLinkEnabled} className="inline">
      <input type="hidden" name="linkId" value={l.public_id} />
      <input type="hidden" name="enable" value={enable ? "1" : "0"} />
      {back && <input type="hidden" name="back" value={back} />}
      <Button type="submit" variant="outline" size="sm">
        {enable ? "Riattiva" : "Disattiva"}
      </Button>
    </form>
  );
}

/** Pagina Link: tutti i link con nome. */
export function NamedLinkList({ links, options }: { links: NamedLinkItem[]; options: TargetOption[] }) {
  if (!links.length) return <p className="muted">Nessun link con nome.</p>;
  return (
    <ul className="share-list">
      {links.map((l) => {
        const state = linkState(l);
        const current =
          l.target_type === "photo"
            ? `Destinazione: la foto «${l.target_title}»`
            : l.target_type
              ? null
              : "Scegli una destinazione…";
        return (
          <li key={l.id} className={state === "active" ? "share-item" : "share-item inactive"}>
            <div className="share-head">
              <strong className="named-link-slug">/l/{l.slug}</strong>
              <span className={`share-state share-state-${state === "active" ? "active" : "inactive"}`}>
                {STATE_LABEL[state]}
              </span>
            </div>
            <div className="share-target">
              → <TargetLabel l={l} />
            </div>
            <Meta l={l} />
            {!l.disabled_at && <CopyField value={l.url} />}
            <div className="share-actions">
              {!l.disabled_at && (
                <NamedLinkEditForm
                  linkId={l.public_id}
                  options={options}
                  current={current}
                  allowDownload={l.allow_download}
                />
              )}
              <span className="share-revoke inline-flex gap-2">
                <EnableForm l={l} />
                {l.disabled_at && (
                  <form action={deleteNamedLink} className="inline">
                    <input type="hidden" name="linkId" value={l.public_id} />
                    <Button type="submit" variant="ghost" size="sm" title="Il nome torna libero">
                      Elimina
                    </Button>
                  </form>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Finestra Condividi di un album o di una foto: link con nome che puntano qui e come puntarne altri. */
export async function NamedLinkPanel({
  targetType,
  targetId,
  back,
  baseUrl,
}: {
  targetType: "album" | "photo";
  targetId: string;
  back: string;
  baseUrl: string;
}) {
  const links = await listNamedLinks();
  const here = links.filter((l) => l.target_type === targetType && l.target_public_id === targetId);
  const others = links
    .filter((l) => !here.includes(l) && !l.disabled_at)
    .map((l) => ({
      publicId: l.public_id,
      label: `${l.slug} (ora: ${l.target_type ? `${l.target_title}` : "nessuna destinazione"})`,
    }));
  const target = `${targetType}:${targetId}`;
  return (
    <section className="named-link-panel">
      <h3>Link con nome</h3>
      <p className="muted share-msg">
        Indirizzi perpetui come {baseUrl}nome, che puoi far puntare altrove quando vuoi. Senza login, mai gli
        originali. Li trovi tutti in <Link href="/admin/link">Link</Link>.
      </p>
      {here.length > 0 && (
        <ul className="share-list">
          {here.map((l) => (
            <li key={l.id} className={l.disabled_at ? "share-item inactive" : "share-item"}>
              <div className="share-head">
                <strong className="named-link-slug">/l/{l.slug}</strong>
                <span className={`share-state share-state-${l.disabled_at ? "inactive" : "active"}`}>
                  {l.disabled_at ? "Disattivato" : "Punta qui"}
                </span>
              </div>
              <Meta l={l} />
              {!l.disabled_at && <CopyField value={l.url} />}
              <div className="share-actions">
                <span className="share-revoke">
                  <EnableForm l={l} back={back} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && <PointHereForm target={target} links={others} back={back} />}
      <NamedLinkCreateForm baseUrl={baseUrl} target={target} back={back} />
    </section>
  );
}
