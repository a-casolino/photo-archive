import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { requireUser } from "@/lib/session";
import { ROLE_LABELS } from "@/lib/roles";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <>
      <header className="topbar">
        <strong>Archivio foto</strong>
        <nav>
          <Link href="/dashboard" prefetch={false}>
            Condivisi con me
          </Link>
          {user.role === "owner" && (
            <Link href="/admin/import" prefetch={false}>
              Import
            </Link>
          )}
          {user.role === "owner" && (
            <Link href="/admin/utenti" prefetch={false}>
              Utenti
            </Link>
          )}
          <Link href="/account" prefetch={false}>
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
