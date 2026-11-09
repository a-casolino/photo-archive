"use client";

import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";

/**
 * Pulsante di un selettore di veduta: salva la scelta in un cookie (un anno)
 * e ricarica la pagina dal server, che legge il cookie e mostra la veduta.
 * È solo una preferenza di visualizzazione, non serve altro.
 */
export function ViewSwitchButton({
  cookie,
  value,
  active,
  label,
  children,
}: {
  cookie: string;
  value: string;
  active: boolean;
  label: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={active ? "active" : undefined}
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={pending}
      onClick={() => {
        if (active) return;
        document.cookie = `${cookie}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
        startTransition(() => router.refresh());
      }}
    >
      {children}
    </button>
  );
}
