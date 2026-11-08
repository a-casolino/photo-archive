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
