import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { AppNav, MobileNav } from "@/app/ui/shell/app-nav";
import { Brand, HEADER_CLASS } from "@/app/ui/shell/brand";
import { Versione } from "@/app/ui/shell/versione";
import { requireUser } from "@/lib/session";
import { ROLE_LABELS } from "@/lib/roles";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const owner = user.role === "owner";
  return (
    <>
      <header className={HEADER_CLASS}>
        <Link href={owner ? "/album" : "/dashboard"} prefetch={false} className="min-w-0 text-foreground no-underline">
          <Brand />
        </Link>
        <AppNav owner={owner} userName={user.name} roleLabel={ROLE_LABELS[user.role]} logout={logout} />
      </header>
      <main className="pb-6">{children}</main>
      {/* pb-24 sul telefono (nel footer): spazio per la barra di navigazione in basso. */}
      <Versione />
      <MobileNav owner={owner} />
    </>
  );
}
