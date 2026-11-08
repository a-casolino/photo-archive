import "@/app/ui/gallery/gallery.css";

/*
 * Pagine dei link liberi: nessun login, nessun menu. Non indicizzate
 * (robots noindex nel layout principale e header X-Robots-Tag).
 */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="topbar">
        <strong>Archivio foto</strong>
        <span className="muted">Condiviso con un link privato</span>
      </header>
      <main>{children}</main>
    </>
  );
}
