"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { createShareAction, regenerateLink, type ShareFormState } from "@/app/actions/shares";
import { ROLE_LABELS } from "@/lib/roles";
import { CopyField } from "./copy-field";

type Person = { id: number; name: string; email: string; role: "trusted" | "viewer" };

function Result({ state }: { state: ShareFormState }) {
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

/** Nuova condivisione di una foto o di un album (solo proprietario). */
export function ShareForm({
  targetType,
  targetId,
  people,
  defaultDays,
}: {
  targetType: "photo" | "album";
  targetId: string;
  people: Person[];
  defaultDays: number;
}) {
  const [state, action, pending] = useActionState(createShareAction, undefined);
  const [mode, setMode] = useState<"users" | "link">(people.length ? "users" : "link");
  const [download, setDownload] = useState<"none" | "preview" | "original">("preview");
  const effectiveDownload = mode === "link" && download === "original" ? "preview" : download;

  // Niente reset automatico del form dopo l'azione (React lo fa con
  // <form action>): i campi controllati resterebbero disallineati.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  }

  return (
    <form action={action} onSubmit={onSubmit} className="form share-form">
      <input type="hidden" name="targetType" value={targetType} />
      <input type="hidden" name="targetId" value={targetId} />

      <fieldset className="choice">
        <legend>Con chi</legend>
        <label>
          <input type="radio" name="mode" value="users" checked={mode === "users"} onChange={() => setMode("users")} />
          Persone con un account (protetta, senza scadenza)
        </label>
        <label>
          <input type="radio" name="mode" value="link" checked={mode === "link"} onChange={() => setMode("link")} />
          Chiunque abbia il link (libera, con scadenza)
        </label>
      </fieldset>

      {mode === "users" ? (
        people.length ? (
          <fieldset className="choice people">
            <legend>Persone</legend>
            {people.map((p) => (
              <label key={p.id}>
                <input type="checkbox" name="recipients" value={p.id} />
                {p.name} <span className="muted">({ROLE_LABELS[p.role]})</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="muted">Non ci sono ancora utenti: invitali dalla pagina Utenti.</p>
        )
      ) : (
        <label>
          Valido per (giorni)
          <input type="number" name="days" min={1} max={365} defaultValue={defaultDays} />
        </label>
      )}

      <label>
        Download
        <select
          name="allowDownload"
          value={effectiveDownload}
          onChange={(e) => setDownload(e.target.value as typeof download)}
        >
          <option value="none">Solo visione</option>
          <option value="preview">JPEG grande</option>
          {mode === "users" && <option value="original">Originale (solo per i Fidati; gli altri il JPEG)</option>}
        </select>
      </label>

      <label>
        Messaggio (facoltativo)
        <textarea name="message" rows={2} maxLength={2000} />
      </label>

      <Result state={state} />
      <button type="submit" disabled={pending}>
        {pending ? "Attendere…" : mode === "link" ? "Crea link" : "Condividi"}
      </button>
    </form>
  );
}

/** "Nuovo link": il token si vede una volta sola, quindi per riaverlo se ne crea uno nuovo. */
export function RegenerateLinkForm({ shareId, back }: { shareId: string; back?: string }) {
  const [state, action, pending] = useActionState(regenerateLink, undefined);
  return (
    <form action={action} className="regen">
      <input type="hidden" name="shareId" value={shareId} />
      {back && <input type="hidden" name="back" value={back} />}
      <button type="submit" className="link" disabled={pending}>
        Nuovo link
      </button>
      <Result state={state} />
    </form>
  );
}
