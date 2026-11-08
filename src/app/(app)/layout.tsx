import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { requireUser } from "@/lib/session";
import { ROLE_LABELS } from "@/lib/roles";
import "@/app/ui/gallery/gallery.css";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const owner = user.role === "owner";
  return (
    <>
      <header className="topbar">
        <strong>Archivio foto</strong>
        <nav>
          {owner ? <Link href="/album">Album</Link> : <Link href="/dashboard">Condivisi con me</Link>}
          {owner && <Link href="/admin/condivisioni">Condivisioni</Link>}
          {owner && <Link href="/admin/import">Import</Link>}
          {owner && <Link href="/admin/utenti">Utenti</Link>}
          <Link href="/account">
            {user.name} <span className="muted">({ROLE_LABELS[user.role]})</span>
          </Link>
          <form action={logout}>
            <button type="submit" className="link">
              Esci
            </button>
          </form>
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
}
