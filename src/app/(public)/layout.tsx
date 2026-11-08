import { Brand, HEADER_CLASS } from "@/app/ui/shell/brand";

/*
 * Pagine dei link liberi: nessun login, nessun menu. Non indicizzate
 * (robots noindex nel layout principale e header X-Robots-Tag).
 */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className={HEADER_CLASS}>
        <Brand />
        <span className="ml-auto text-sm text-muted-foreground">Condiviso con un link privato</span>
      </header>
      <main>{children}</main>
    </>
  );
}
