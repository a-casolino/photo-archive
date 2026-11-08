/**
 * Titolo del sito con il punto rosso, in testa a ogni pagina. Sempre intero
 * («Antonio Casolino | Photo Archive», come il <title>), anche sul telefono.
 */
export function Brand() {
  return (
    <span className="flex min-w-0 items-center gap-2.5 font-semibold whitespace-nowrap">
      <span className="size-2.5 shrink-0 rounded-full bg-brand" aria-hidden />
      <span className="truncate">Antonio Casolino | Photo Archive</span>
    </span>
  );
}

export const HEADER_CLASS =
  "sticky top-0 z-40 flex h-14 items-center gap-6 border-b bg-background/85 px-4 backdrop-blur-md md:px-6";
