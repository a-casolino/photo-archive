"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Menu "Ordina": salva la scelta in un cookie (un anno) e ricarica la pagina
 * dal server, che legge il cookie e ordina l'elenco. Vale per tutte le visite.
 */
export function SortSelect({
  cookie,
  value,
  options,
  label,
  className,
}: {
  cookie: string;
  value: string;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <select
      className={className}
      aria-label={label}
      title={label}
      value={value}
      disabled={pending}
      onChange={(e) => {
        document.cookie = `${cookie}=${encodeURIComponent(e.target.value)}; path=/; max-age=31536000; samesite=lax`;
        startTransition(() => router.refresh());
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
