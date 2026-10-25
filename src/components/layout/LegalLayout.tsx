import { Outlet } from "@tanstack/react-router";
import { AppLink } from "@/components/cm/app-link";
import { Logo } from "@/components/cm/brand";
import { ThemeToggle } from "@/components/layout/AppShell";
import { LegalLinks } from "@/components/layout/LegalLinks";
import { ArrowLeft } from "@/components/icons";

/** Gabarit des pages légales : lisible sans être connecté (inscription) comme connecté. */
export function LegalLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-4">
        <AppLink to="/" aria-label="Accueil CampusMarket"><Logo size="sm" showTagline={false} /></AppLink>
        <ThemeToggle />
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10 pt-2">
        <button type="button" onClick={() => (window.history.length > 1 ? window.history.back() : (window.location.href = "/"))} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-[18px]" /> Retour
        </button>
        <Outlet />
      </main>
      <footer className="border-t border-border px-4 py-5"><LegalLinks /></footer>
    </div>
  );
}
