/*
 * Mentre il server prepara una pagina dell'area riservata (album, foto,
 * persone…) si vede subito questo segnaposto, sotto la barra in alto: il
 * click risponde all'istante invece di lasciare ferma la pagina precedente.
 */
export default function Loading() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="sr-only">Caricamento…</span>
      <div className="page-loading-title" />
      <ul className="page-loading-grid" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <li key={i} />
        ))}
      </ul>
    </div>
  );
}
