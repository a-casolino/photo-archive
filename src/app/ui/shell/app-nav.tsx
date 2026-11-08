"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ImagesIcon,
  InboxIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  Share2Icon,
  TagsIcon,
  Trash2Icon,
  UploadIcon,
  UserCogIcon,
  UserIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon; mobile?: boolean };

// Voci del proprietario: quelle con mobile=true stanno nella barra in basso del
// telefono, le altre nel menu «Altro».
const OWNER_ITEMS: NavItem[] = [
  { href: "/album", label: "Album", icon: ImagesIcon, mobile: true },
  { href: "/tag", label: "Tag", icon: TagsIcon, mobile: true },
  { href: "/persone", label: "Persone", icon: UsersIcon, mobile: true },
  { href: "/admin/condivisioni", label: "Condivisioni", icon: Share2Icon, mobile: true },
  { href: "/admin/import", label: "Import", icon: UploadIcon },
  { href: "/admin/cestino", label: "Cestino", icon: Trash2Icon },
  { href: "/admin/utenti", label: "Utenti", icon: UserCogIcon },
];

const VIEWER_ITEMS: NavItem[] = [{ href: "/dashboard", label: "Condivisi con me", icon: InboxIcon, mobile: true }];

const LOGOUT_FORM = "logout-form";

function isActive(pathname: string, href: string) {
  if (href === "/album" && pathname.startsWith("/foto/")) return true;
  if (href === "/dashboard" && pathname.startsWith("/condivisi/")) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/**
 * Navigazione in testa alla pagina: voci con icona (dal tablet in su) e menu
 * dell'utente con Account ed Esci.
 */
export function AppNav({
  owner,
  userName,
  roleLabel,
  logout,
}: {
  owner: boolean;
  userName: string;
  roleLabel: string;
  logout: () => Promise<void>;
}) {
  const pathname = usePathname();
  const items = owner ? OWNER_ITEMS : VIEWER_ITEMS;

  return (
    <>
      <nav aria-label="Sezioni" className="hidden items-center gap-0.5 md:flex">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-foreground",
                active && "bg-accent text-foreground",
              )}
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      <form id={LOGOUT_FORM} action={logout} hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="grid size-8 place-items-center rounded-full bg-foreground text-[0.8rem] font-semibold text-background outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          aria-label={`Menu di ${userName}`}
        >
          {initials(userName)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            <span className="block">{userName}</span>
            <span className="block text-sm font-normal text-muted-foreground">{roleLabel}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/account" prefetch={false}>
              <UserIcon />
              Account
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <button type="submit" form={LOGOUT_FORM}>
              <LogOutIcon />
              Esci
            </button>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * Telefono: barra fissa in basso con le voci principali e «Altro».
 * Va fuori dall'<header>: il suo backdrop-filter farebbe da riferimento al
 * position: fixed e la barra finirebbe in alto.
 */
export function MobileNav({ owner }: { owner: boolean }) {
  const pathname = usePathname();
  const items = owner ? OWNER_ITEMS : VIEWER_ITEMS;
  const more = items.filter((i) => !i.mobile);
  return (
    <nav
      aria-label="Sezioni"
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch justify-around border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items
        .filter((i) => i.mobile)
        .map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 text-[0.72rem] text-muted-foreground no-underline",
                active && "text-primary",
              )}
            >
              <item.icon className="size-5" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      {more.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-[0.72rem] text-muted-foreground outline-none",
              more.some((i) => isActive(pathname, i.href)) && "text-primary",
            )}
          >
            <MoreHorizontalIcon className="size-5" aria-hidden />
            Altro
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            {more.map((item) => (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={item.href} prefetch={false}>
                  <item.icon />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
}
