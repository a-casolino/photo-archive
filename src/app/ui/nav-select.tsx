"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Menu che porta a un altro indirizzo appena si sceglie una voce (filtri
 * semplici, senza il pulsante «Filtra»). Gli indirizzi li prepara il server.
 */
export function NavSelect({
  value,
  options,
  label,
  className,
}: {
  value: string;
  options: { value: string; label: string; href: string }[];
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
        const href = options.find((o) => o.value === e.target.value)?.href;
        if (href) startTransition(() => router.push(href));
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
