/**
 * Versione dell'app in piccolo in fondo alla pagina: "v0.<ultima PR>",
 * calcolata durante la build (vedi next.config.ts). Passandoci sopra si vede
 * il commit esatto. Il footer c'è sempre: sul telefono lascia lo spazio per
 * la barra di navigazione in basso.
 */
export function Versione() {
  const versione = process.env.APP_VERSION;
  const commit = process.env.APP_COMMIT;
  return (
    <footer className="px-4 pb-24 text-center text-xs text-muted-foreground/70 md:px-6 md:pb-6">
      {versione ? (
        <span title={commit ? `commit ${commit}` : undefined} className="tabular-nums">
          {versione}
        </span>
      ) : null}
    </footer>
  );
}
