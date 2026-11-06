"use client";

import { useActionState, useState } from "react";
import { createDeviceKey, type NewDeviceState } from "@/app/actions/imports";

/** Crea la chiave di un computer e la mostra una sola volta. */
export function NewDeviceForm() {
  const [state, action, pending] = useActionState<NewDeviceState, FormData>(createDeviceKey, undefined);
  const [copied, setCopied] = useState(false);

  if (state?.token) {
    return (
      <div className="form">
        <p className="msg msg-ok" role="status">
          Chiave creata per «{state.name}». Copiala adesso: non verrà più mostrata.
        </p>
        <div className="token-box">
          <code>{state.token}</code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(state.token!).then(() => setCopied(true));
            }}
          >
            {copied ? "Copiata" : "Copia"}
          </button>
        </div>
        <p className="muted">
          Sul computer, mettila nel file <code>.env.local</code> della cartella del progetto:
        </p>
        <pre className="cmd">IMPORT_KEY={state.token}</pre>
      </div>
    );
  }

  return (
    <form action={action} className="form">
      <label>
        Nome del computer
        <input name="name" required maxLength={120} placeholder="MacBook di Antonio" />
      </label>
      {state?.error && (
        <p className="msg msg-error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Attendere…" : "Crea chiave"}
      </button>
    </form>
  );
}
