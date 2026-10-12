import { useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Logo } from "@/components/cm/brand";
import { AppLink } from "@/components/cm/app-link";
import { UserMenu, ThemeToggle, NotificationsMenu } from "@/components/layout/AppShell";
import {
  BarChart, Buildings, Flag, Globe2, Home, LayoutDashboard, LifeBuoy, Menu, ShieldCheck, Sliders, Store, Users,
} from "@/components/icons";

const adminNav = [
  { label: "Tableau de bord", to: "/admin", icon: LayoutDashboard },
  { label: "Utilisateurs", to: "/admin/utilisateurs", icon: Users },
  { label: "Annonces", to: "/admin/annonces", icon: Store },
  { label: "Universités", to: "/admin/universites", icon: Buildings },
  { label: "Géographie", to: "/admin/geographie", icon: Globe2 },
  { label: "Statistiques", to: "/admin/statistiques", icon: BarChart },
  { label: "Support", to: "/admin/support", icon: LifeBuoy },
  { label: "Paramètres", to: "/admin/parametres", icon: Sliders },
  { label: "Sécurité", to: "/admin/securite", icon: ShieldCheck },
] as const;

function useIsActive() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (to: string) => (to === "/admin" ? pathname === "/admin" : pathname === to || pathname.startsWith(`${to}/`));
}

function NavList({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const isActive = useIsActive();
  return (
    <ul className="space-y-0.5">
      {adminNav.map(({ label, to, icon: Icon }) => {
        const active = isActive(to);
        return (
          <li key={label}>
            <AppLink to={to} onClick={onNavigate} aria-current={active ? "page" : undefined}
              className={cn("flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}>
              <Icon className="size-[18px]" />{label}
            </AppLink>
          </li>
        );
      })}
    </ul>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  return (
    <div className="flex h-full flex-col p-4">
      <AppLink to="/admin" onClick={onNavigate} className="mb-1 block rounded-md"><Logo /></AppLink>
      <p className="mb-5 px-1 text-[11px] font-bold uppercase tracking-wider text-primary">Espace administrateur</p>
      <nav aria-label="Navigation admin" className="flex-1 space-y-1 overflow-y-auto pr-1"><NavList onNavigate={onNavigate} /></nav>
      <div className="mt-4 border-t border-sidebar-border pt-3">
        <AppLink to="/" onClick={onNavigate} className="mb-3 flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-sidebar-accent"><Home className="size-[18px]" /> Retour à l'application</AppLink>
        <UserMenu />
      </div>
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#contenu-admin" className="sr-only z-[100] rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Aller au contenu</a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:block"><SidebarBody /></aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">Menu admin</SheetTitle>
          <SidebarBody onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="md:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-xl sm:gap-3 sm:px-4 lg:px-7">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMenuOpen(true)} aria-label="Ouvrir le menu"><Menu className="size-6" /></Button>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><Flag className="size-4 text-primary" /> Modération &amp; administration</span>
          <div className="ml-auto flex items-center gap-1"><ThemeToggle className="hidden sm:inline-flex" /><NotificationsMenu /><div className="ml-1 hidden md:block"><UserMenu variant="header" /></div></div>
        </header>
        <main id="contenu-admin" className="mx-auto max-w-[1500px] px-4 pb-10 pt-5 lg:px-7 lg:pt-7">{children}</main>
      </div>
    </div>
  );
}
