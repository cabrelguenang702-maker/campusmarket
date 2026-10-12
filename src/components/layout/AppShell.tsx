import { useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Bell, BadgeCheck, ChevronRight, Settings, HelpCircle, Home, Menu, MessageCircle, Moon, Plus, Store, Sun, User,
  LogOut, ShoppingBag, Compass, ShieldCheck,
} from "@/components/icons";
import { Logo } from "@/components/cm/brand";
import { Avatar } from "@/components/cm/commerce";
import { AppLink } from "@/components/cm/app-link";
import { SearchField } from "@/components/cm/forms";
import { mainNav, secondaryNav, type NavItem } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth";
import { useMessagesRealtime, useConversations } from "@/lib/api/messages";
import { useNotifications, useNotificationActions, useNotificationsRealtime } from "@/lib/api/notifications";
import { categoryMeta, splitTo } from "@/lib/notification-meta";
import { useThemeState, type ThemeMode } from "@/lib/theme";

function useIsActive() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (to: string) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`));
}

/* ---------- Liste de navigation (sidebar + menu mobile) ---------- */
/** Pastilles de la navigation : messages et notifications non lus (compteurs réels, mis à jour en temps réel). */
function useNavBadges(): Record<string, number> {
  const { session } = useAuth();
  const userId = session?.user.id;
  const conversations = useConversations(userId).data ?? [];
  const notifications = useNotifications(userId).data ?? [];
  return { Messages: conversations.reduce((n, c) => n + (c.archived ? 0 : c.unread), 0), Notifications: notifications.filter((n) => n.unread).length };
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: (() => void) | undefined }) {
  const isActive = useIsActive();
  const badges = useNavBadges();
  return (
    <ul className="space-y-0.5">
      {items.map(({ label, to, icon: Icon }) => {
        const active = isActive(to);
        const badge = badges[label];
        return (
          <li key={label}>
            <AppLink
              to={to}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-[18px]" />
              {label}
              {badge ? (
                <span className={cn("ml-auto grid min-w-5 place-items-center rounded-full px-1.5 text-[10px] font-bold leading-5", active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/15 text-primary")}>{badge > 99 ? "99+" : badge}</span>
              ) : null}
            </AppLink>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- Menu utilisateur ---------- */
const themeLabels: Record<ThemeMode, string> = { light: "Clair", dark: "Sombre", system: "Automatique" };

export function UserMenu({ variant = "sidebar" }: { variant?: "sidebar" | "header" }) {
  const { mode, setMode } = useThemeState();
  const navigate = useNavigate();
  const { account, accountStatus, hasBackOffice, signOut } = useAuth();
  const profile = account?.profile;
  // Tant que le profil n'est pas chargé on n'affiche ni faux nom ni fausses initiales.
  const name = profile?.fullName ?? (accountStatus === "error" ? "Compte" : "Chargement…");
  const subtitle = profile ? [profile.campus, profile.city].filter(Boolean).join(" · ") || "Campus non renseigné" : "";
  const logout = async () => {
    await signOut();
    void navigate({ to: "/connexion", replace: true });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "sidebar" ? (
          <button className="flex w-full items-center gap-3 rounded-md p-2 text-left transition hover:bg-sidebar-accent" aria-label="Menu utilisateur">
            <Avatar name={name} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">{name}</span>
              <span className="block truncate text-[10px] text-muted-foreground">{subtitle}</span>
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        ) : (
          <button className="rounded-full ring-offset-background transition hover:ring-2 hover:ring-primary/40" aria-label="Menu utilisateur"><Avatar name={name} size="sm" /></button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={variant === "sidebar" ? "start" : "end"} side={variant === "sidebar" ? "top" : "bottom"} className="w-60">
        <DropdownMenuLabel className="flex items-center gap-3 py-2">
          <Avatar name={name} size="md" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{name}</span>
            {profile?.verified
              ? <span className="flex items-center gap-1 text-[11px] font-normal text-primary"><BadgeCheck className="size-3.5" /> Étudiant vérifié</span>
              : <span className="block text-[11px] font-normal text-muted-foreground">Compte non vérifié</span>}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {[
          { label: "Mon profil", to: "/profil", icon: User },
          { label: "Mes annonces", to: "/profil/annonces", icon: Store },
          { label: "Mes achats", to: "/profil/achats", icon: ShoppingBag },
          { label: "Vérification du compte", to: "/profil/verification", icon: BadgeCheck },
          { label: "Paramètres", to: "/profil/parametres", icon: Settings },
          { label: "Centre d'aide", to: "/aide", icon: HelpCircle },
          ...(hasBackOffice ? [{ label: "Administration", to: "/admin", icon: ShieldCheck }] : []),
        ].map(({ label, to, icon: Icon }) => (
          <DropdownMenuItem key={label} asChild className="cursor-pointer">
            <AppLink to={to}><Icon /> {label}</AppLink>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Thème</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as ThemeMode)}>
          {(Object.keys(themeLabels) as ThemeMode[]).map((m) => (
            <DropdownMenuRadioItem key={m} value={m} className="cursor-pointer">{themeLabels[m]}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onSelect={() => void logout()}>
          <LogOut /> Se déconnecter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------- Menu notifications ---------- */
export function NotificationsMenu() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const q = useNotifications(session?.user.id);
  const actions = useNotificationActions();
  const all = q.data ?? [];
  const unread = all.filter((n) => n.unread).length;
  const recent = all.slice(0, 4);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications (${unread} non lues)`} className="relative">
          <Bell className="size-5" />
          {unread > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-primary ring-2 ring-background" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,22rem)] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="font-display text-sm font-bold">Notifications</p>
          <button disabled={unread === 0 || actions.readAll.isPending} onClick={() => actions.readAll.mutate()} className="text-xs font-semibold text-primary hover:underline disabled:opacity-40 disabled:no-underline">Tout marquer comme lu</button>
        </div>
        {q.isLoading ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">Chargement…</p>
        ) : recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">Aucune notification pour le moment.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {recent.map((n) => {
              const Icon = categoryMeta[n.category].icon;
              return (
                <li key={n.id}>
                  <button onClick={() => { if (n.unread) actions.read.mutate([n.id]); setOpen(false); const { to, search } = splitTo(n.to); void navigate({ to: to as "/", search: search as never }); }} className={cn("flex w-full gap-3 px-4 py-3 text-left transition hover:bg-accent/40", n.unread && "bg-primary/5")}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-primary"><Icon className="size-[18px]" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{n.title}</span><span className="shrink-0 text-[10px] text-muted-foreground">{n.time}</span></span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>
                    </span>
                    {n.unread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <AppLink to="/notifications" onClick={() => setOpen(false)} className="block border-t border-border px-4 py-3 text-center text-xs font-semibold text-primary hover:bg-accent">Voir toutes les notifications</AppLink>
      </PopoverContent>
    </Popover>
  );
}

export function ThemeToggle({ className }: { className?: string | undefined }) {
  const { resolved, setMode } = useThemeState();
  return (
    <Button variant="ghost" size="icon" className={className} aria-label={resolved === "dark" ? "Passer au thème clair" : "Passer au thème sombre"} onClick={() => setMode(resolved === "dark" ? "light" : "dark")}>
      {resolved === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </Button>
  );
}

/* ---------- Corps de la barre latérale ---------- */
function SidebarBody({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  return (
    <div className="flex h-full flex-col p-4">
      <AppLink to="/" onClick={onNavigate} className="mb-6 block rounded-md"><Logo /></AppLink>
      <nav aria-label="Navigation principale" className="flex-1 space-y-5 overflow-y-auto pr-1">
        <NavList items={mainNav.filter((i) => i.label !== "Explorer")} onNavigate={onNavigate} />
        <div>
          <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Mon espace</p>
          <NavList items={secondaryNav} onNavigate={onNavigate} />
        </div>
      </nav>
      <div className="mt-4 rounded-lg border border-border bg-secondary/70 p-3 [@media(max-height:860px)]:hidden">
        <p className="text-xs font-semibold">Besoin d'aide ?</p>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Notre équipe répond à vos questions.</p>
        <Button asChild variant="outline" size="sm" className="mt-3 w-full"><AppLink to="/aide" onClick={onNavigate}><HelpCircle /> Centre d'aide</AppLink></Button>
      </div>
      <div className="mt-4 border-t border-sidebar-border pt-3"><UserMenu /></div>
    </div>
  );
}

/* ---------- Navigation basse (mobile) ---------- */
function BottomNav() {
  const isActive = useIsActive();
  const items = [
    { label: "Accueil", to: "/", icon: Home },
    { label: "Explorer", to: "/marketplace", icon: Compass },
    { label: "Publier", to: "/publier", icon: Plus },
    { label: "Messages", to: "/messages", icon: MessageCircle },
    { label: "Profil", to: "/profil", icon: User },
  ];
  return (
    <nav aria-label="Navigation mobile" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur md:hidden">
      <ul className="grid grid-cols-5 px-2 py-1.5">
        {items.map(({ label, to, icon: Icon }) => {
          const publish = label === "Publier";
          const active = !publish && isActive(to);
          return (
            <li key={label}>
              <AppLink to={to} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 py-1 text-[10px] font-medium", active || publish ? "text-primary" : "text-muted-foreground")}>
                {publish ? (
                  <span className="-mt-5 grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-glow ring-4 ring-background"><Icon className="size-6" /></span>
                ) : (
                  <Icon className="size-[22px]" />
                )}
                <span className={publish ? "mt-0.5" : ""}>{label}</span>
              </AppLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  useMessagesRealtime(session?.user.id);
  useNotificationsRealtime(session?.user.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#contenu" className="sr-only z-[100] rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Aller au contenu</a>

      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:block">
        <SidebarBody />
      </aside>

      {/* Menu mobile */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">Menu principal</SheetTitle>
          <SidebarBody onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="md:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-xl sm:gap-3 sm:px-4 lg:px-7">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMenuOpen(true)} aria-label="Ouvrir le menu"><Menu className="size-6" /></Button>
          <form className="max-w-xl flex-1" role="search" onSubmit={(e) => { e.preventDefault(); void navigate({ to: "/marketplace", search: query.trim() ? { q: query.trim() } : {} }); }}>
            <SearchField placeholder="Rechercher un produit, une formation, un étudiant…" aria-label="Recherche" value={query} onChange={(e) => setQuery(e.target.value)} />
          </form>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle className="hidden sm:inline-flex" />
            <NotificationsMenu />
            <Button asChild className="ml-1 hidden sm:inline-flex"><AppLink to="/publier"><Plus /> Publier</AppLink></Button>
            <div className="ml-1 hidden md:block"><UserMenu variant="header" /></div>
          </div>
        </header>
        <main id="contenu" className="mx-auto max-w-[1500px] px-4 pb-28 pt-5 md:pb-10 lg:px-7 lg:pt-7">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
