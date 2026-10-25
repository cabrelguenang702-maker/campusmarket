import type { ReactNode } from "react";
import { Outlet } from "@tanstack/react-router";
import { Check, HelpCircle } from "@/components/icons";
import heroImage from "@/assets/campus-market-hero.jpg";
import { Logo } from "@/components/cm/brand";
import { AppLink } from "@/components/cm/app-link";
import { ThemeToggle } from "@/components/layout/AppShell";
import { LegalLinks } from "@/components/layout/LegalLinks";
import { OnboardingProvider } from "@/lib/onboarding";

const perks = [
  "Achetez et vendez entre étudiants, près de votre campus",
  "Formations, communautés et événements de votre université",
  "Paiement Mobile Money et profils vérifiés",
];

/** Layout des écrans d'authentification (inscription, connexion, récupération). */
export function AuthLayout({ children }: { children?: ReactNode }) {
  return (
    <OnboardingProvider>
      <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Panneau de marque — desktop uniquement, toujours sombre */}
        <aside className="dark relative hidden overflow-hidden bg-background text-foreground lg:block">
          <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-background/30" />
          <div className="relative z-10 flex h-full min-h-screen flex-col justify-between p-10">
            <AppLink to="/bienvenue"><Logo size="md" /></AppLink>
            <div className="max-w-md">
              <h2 className="font-display text-4xl font-bold leading-tight">Le campus africain où l'on achète, vend, apprend et échange.</h2>
              <ul className="mt-6 space-y-3">
                {perks.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-sm text-foreground/80">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/20 text-primary"><Check className="size-3.5" /></span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">© 2026 CampusMarket · Made for African students</p>
          </div>
        </aside>

        <div className="brand-glow flex min-h-screen flex-col">
          <header className="flex items-center justify-between px-4 py-4 sm:px-8">
            <AppLink to="/bienvenue" className="lg:invisible"><Logo size="sm" showTagline={false} /></AppLink>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <AppLink to="/aide" className="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"><HelpCircle className="size-[18px]" /> Aide</AppLink>
            </div>
          </header>
          <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-10 pt-2 sm:pt-6">{children ?? <Outlet />}</main>
          <LegalLinks className="px-4 pb-6" newTab />
        </div>
      </div>
    </OnboardingProvider>
  );
}
