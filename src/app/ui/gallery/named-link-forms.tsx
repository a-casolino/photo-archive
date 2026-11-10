"use client";

import { useActionState, useState } from "react";
import { createNamedLink, updateNamedLink, type NamedLinkState } from "@/app/actions/links";
import { Button } from "@/components/ui/button";
import { normalizeSlug } from "@/lib/named-link-rules";
import { CopyField } from "./copy-field";

/*
 * Form dei link con nome (solo proprietario). La destinazione viaggia come
 * "album:<public_id>" o "photo:<public_id>".
 */

export type TargetOption = { value: string; label: string };

function Result({ state }: { state: NamedLinkState }) {
  if (!state) return null;
  return (
    <>
      {state.error && (
        <p className="msg msg-error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="msg msg-ok" role="status">
          {state.ok}
        </p>
      )}
      {state.link && <CopyField value={state.link} />}
    </>
  );
}

/**
 * Nuovo link con nome. Con `target` punta lì (finestra Condividi); senza,
 * si sceglie l'album dall'elenco `options` (pagina Link).
 */
export function NamedLinkCreateForm({
  baseUrl,
  target,
  options = [],
  back,
}: {
  /** "https://foto.acasolino.com/l/" */
  baseUrl: string;
  target?: string;
  options?: TargetOption[];
  back?: string;
}) {
  const [state, action, pending] = useActionState(createNamedLink, undefined);
  const [name, setName] = useState("");
  const slug = normalizeSlug(name);
  return (
    <form action={action} className="form named-link-form">
      {target ? <input type="hidden" name="target" value={target} /> : null}
      {back && <input type="hidden" name="back" value={back} />}
      <label>
        {target ? "Oppure crea un nuovo link che punta qui" : "Nome"}
        <input
          name="name"
          required
          maxLength={60}
          placeholder="es. vizzarri"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <span className="named-link-preview">
          {baseUrl}
          <strong>{slug || "…"}</strong>
        </span>
      </label>
      {!target && (
        <label>
          Punta a
          <select name="target" required defaultValue="">
            <option value="" disabled>
              Scegli un album…
            </option>
            <option value="none">Nessuna destinazione (pagina vuota)</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="muted">Per far puntare il link a una singola foto usa Condividi dalla pagina della foto.</span>
        </label>
      )}
      <label>
        Download
        <select name="allowDownload" defaultValue="preview">
          <option value="none">Solo visione</option>
          <option value="preview">JPEG grande</option>
        </select>
      </label>
      <Result state={state} />
      <button type="submit" disabled={pending}>
        {pending ? "Attendere…" : target ? "Crea link qui" : "Crea link"}
      </button>
    </form>
  );
}

/** Finestra Condividi: fa puntare qui uno dei link con nome già esistenti. */
export function PointHereForm({
  target,
  links,
  back,
}: {
  target: string;
  links: { publicId: string; label: string }[];
  back?: string;
}) {
  const [state, action, pending] = useActionState(updateNamedLink, undefined);
  return (
    <form action={action} className="form">
      <input type="hidden" name="target" value={target} />
      {back && <input type="hidden" name="back" value={back} />}
      <label>
        Fai puntare qui un link esistente
        <span className="named-link-row">
          <select name="linkId" required defaultValue="">
            <option value="" disabled>
              Scegli un link…
            </option>
            {links.map((l) => (
              <option key={l.publicId} value={l.publicId}>
                {l.label}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" disabled={pending}>
            Punta qui
          </Button>
        </span>
      </label>
      <Result state={state} />
    </form>
  );
}

/** Pagina Link: cambia destinazione (tra gli album) e download di un link. */
export function NamedLinkEditForm({
  linkId,
  options,
  current,
  allowDownload,
}: {
  linkId: string;
  options: TargetOption[];
  /** Destinazione attuale se non è tra le opzioni (una foto, o niente). */
  current: string | null;
  allowDownload: "none" | "preview";
}) {
  const [state, action, pending] = useActionState(updateNamedLink, undefined);
  return (
    <form action={action} className="named-link-edit">
      <input type="hidden" name="linkId" value={linkId} />
      <select name="target" defaultValue="" aria-label="Nuova destinazione">
        <option value="">{current ?? "Destinazione: invariata"}</option>
        <option value="none">Nessuna destinazione (pagina vuota)</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select name="allowDownload" defaultValue={allowDownload} aria-label="Download">
        <option value="none">Solo visione</option>
        <option value="preview">JPEG grande</option>
      </select>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        Salva
      </Button>
      <Result state={state} />
    </form>
  );
}
