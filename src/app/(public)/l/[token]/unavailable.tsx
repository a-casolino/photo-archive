/** Link scaduto, revocato o sbagliato: stesso messaggio per tutti i casi. */
export function LinkUnavailable() {
  return (
    <section className="card" style={{ maxWidth: 480 }}>
      <h1>Link non disponibile</h1>
      <p className="muted">
        Il link è scaduto, è stato revocato oppure non è scritto giusto. Chiedi a chi te l&apos;ha mandato di
        rinnovarlo.
      </p>
    </section>
  );
}

/** Link con nome che ora non mostra niente (nessuna destinazione, nel cestino o disattivato). */
export function LinkEmpty() {
  return (
    <section className="card" style={{ maxWidth: 480 }}>
      <h1>Qui non c&apos;è ancora niente</h1>
      <p className="muted">
        Questo link al momento non mostra nessun album e nessuna foto. Contatta l&apos;amministratore
        dell&apos;archivio.
      </p>
    </section>
  );
}
