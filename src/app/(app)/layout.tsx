import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { AppNav, MobileNav } from "@/app/ui/shell/app-nav";
import { Brand, HEADER_CLASS } from "@/app/ui/shell/brand";
import { requireUser } from "@/lib/session";
import { ROLE_LABELS } from "@/lib/roles";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const owner = user.role === "owner";
  return (
    <>
      <header className={HEADER_CLASS}>
        <Link href={owner ? "/album" : "/dashboard"} prefetch={false} className="text-foreground no-underline">
          <Brand />
        </Link>
        <AppNav owner={owner} userName={user.name} roleLabel={ROLE_LABELS[user.role]} logout={logout} />
      </header>
      {/* pb-24 sul telefono: spazio per la barra di navigazione in basso. */}
      <main className="pb-24 md:pb-6">{children}</main>
      <MobileNav owner={owner} />
    </>
  );
}
