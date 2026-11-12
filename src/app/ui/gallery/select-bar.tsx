"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * Barra della selezione multipla: conta le caselle `name` spuntate nel form
 * che la contiene, offre "Seleziona tutte / Nessuna" e disattiva i pulsanti
 * finché non c'è almeno una foto selezionata.
 */
export function SelectBar({
  name,
  children,
  single,
  masculine = false,
}: {
  name: string;
  /** Per gli album: "selezionati", "Seleziona tutti", "Nessuno". */
  masculine?: boolean;
  children: ReactNode;
  /** Azioni che valgono per una sola foto: attive solo con esattamente una selezionata. */
  single?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);

  const boxes = () =>
    Array.from(ref.current?.closest("form")?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`) ?? []);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () => {
      const all = Array.from(form.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`));
      setTotal(all.length);
      setCount(all.filter((b) => b.checked).length);
    };
    update();
    form.addEventListener("change", update);
    return () => form.removeEventListener("change", update);
  }, [name]);

  function setAll(checked: boolean) {
    for (const b of boxes()) b.checked = checked;
    setCount(checked ? total : 0);
  }

  return (
    <div ref={ref} className="select-bar">
      <strong>
        {count} selezionat{masculine ? (count === 1 ? "o" : "i") : count === 1 ? "a" : "e"} su {total}
      </strong>
      <button type="button" className="link" onClick={() => setAll(count < total)}>
        {count < total ? `Seleziona tutt${masculine ? "i" : "e"}` : masculine ? "Nessuno" : "Nessuna"}
      </button>
      <fieldset disabled={count === 0} style={{ display: "contents" }}>
        {children}
      </fieldset>
      {single && (
        <fieldset disabled={count !== 1} style={{ display: "contents" }}>
          {single}
        </fieldset>
      )}
    </div>
  );
}

/** Pulsante per un'azione irreversibile: attivo solo dopo aver spuntato la conferma. */
export function ConfirmButton({
  label,
  confirmLabel,
  formAction,
}: {
  label: string;
  confirmLabel: string;
  formAction: (formData: FormData) => Promise<void>;
}) {
  const [ok, setOk] = useState(false);
  return (
    <>
      <label className="confirm">
        <input type="checkbox" name="conferma" value="si" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        {confirmLabel}
      </label>
      <button type="submit" className="danger" disabled={!ok} formAction={formAction}>
        {label}
      </button>
    </>
  );
}
