/** Nome dell'app con il punto rosso, in testa a ogni pagina. */
export function Brand() {
  return (
    <span className="flex items-center gap-2.5 font-semibold whitespace-nowrap">
      <span className="size-2.5 rounded-full bg-brand" aria-hidden />
      Antonio Casolino
      <span className="hidden font-normal text-muted-foreground sm:inline">| Photo Archive</span>
    </span>
  );
}

export const HEADER_CLASS =
  "sticky top-0 z-40 flex h-14 items-center gap-6 border-b bg-background/85 px-4 backdrop-blur-md md:px-6";
