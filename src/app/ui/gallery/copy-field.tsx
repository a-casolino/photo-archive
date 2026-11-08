"use client";

import { useState } from "react";

/** Campo in sola lettura con pulsante "Copia" (per i link liberi). */
export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy-field">
      <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label="Link" />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copiato" : "Copia"}
      </button>
    </span>
  );
}
