"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import type { FormState } from "@/lib/validation";

/**
 * Form collegato a una Server Action, con messaggio di errore/esito.
 * A differenza di <form action>, non svuota i campi quando c'è un errore
 * (così non si deve riscrivere l'email dopo una password sbagliata);
 * li svuota solo quando l'azione va a buon fine.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form ref={ref} action={formAction} onSubmit={onSubmit} className="form">
      {children}
      {state?.error && (
        <p className="msg msg-error" role="alert">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="msg msg-ok" role="status">
          {state.ok}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Attendere…" : submitLabel}
      </button>
    </form>
  );
}
