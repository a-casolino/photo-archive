"use client";

import { useId, useRef, useState } from "react";

const MAX_SHOWN = 6;

/** Minuscole e senza accenti, per confrontare i nomi. */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function wordStart(folded: string, q: string): boolean {
  return folded.startsWith(q) || folded.includes(` ${q}`);
}

/**
 * Campo "Chi è?" con i nomi delle persone già esistenti come suggerimenti.
 * Sostituisce <datalist>: su Chrome per Android il suo menu nativo si
 * disegna sopra la pagina, semitrasparente e con i nomi sovrapposti.
 * Qui l'elenco è parte della pagina, sotto il campo.
 */
export function NameInput({ names, name = "name", label = "Chi è?" }: { names: string[]; name?: string; label?: string }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const q = fold(value);
  // Prima i nomi in cui una parola inizia con ciò che si scrive, poi gli altri che lo contengono.
  const matches = q
    ? names
        .map((n) => ({ n, f: fold(n) }))
        .filter(({ f }) => f.includes(q) && f !== q)
        .sort((a, b) => Number(!wordStart(a.f, q)) - Number(!wordStart(b.f, q)))
        .slice(0, MAX_SHOWN)
        .map(({ n }) => n)
    : [];
  const shown = open && matches.length > 0;

  function pick(n: string) {
    setValue(n);
    setOpen(false);
    input.current?.focus();
  }

  return (
    <label className="name-input">
      {label}
      <input
        ref={input}
        name={name}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        required
        maxLength={120}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
      />
      {shown && (
        <ul id={listId} role="listbox" className="name-suggestions">
          {matches.map((n) => (
            <li key={n} role="option" aria-selected={false}>
              <button
                type="button"
                // mousedown prima del blur: il campo non perde il fuoco e la tastiera resta aperta
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(n)}
              >
                {n}
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
