import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Bell, Devices, Eye, Settings, ShieldCheck, User } from "@/components/icons";
import { AccountSection, DevicesSection, GeneralSection, PrivacySection } from "@/components/settings/OtherSections";
import { NotificationPreferences } from "@/components/settings/NotificationPreferences";
import { InstallApp } from "@/components/settings/InstallApp";
import { SecuritySection, type SecuritySub } from "@/components/settings/SecuritySection";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";

type Section = "general" | "confidentialite" | "notifications" | "securite" | "appareils" | "compte";
export type SettingsSearch = { section?: Section | undefined };

const sections: { id: Section; label: string; icon: typeof Settings }[] = [
  { id: "general", label: "Général", icon: Settings },
  { id: "confidentialite", label: "Confidentialité", icon: Eye },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "securite", label: "Sécurité", icon: ShieldCheck },
  { id: "appareils", label: "Appareils", icon: Devices },
  { id: "compte", label: "Compte", icon: User },
];

export const Route = createFileRoute("/_app/profil/parametres")({
  validateSearch: (s: Record<string, unknown>): SettingsSearch => ({ section: sections.find((x) => x.id === s["section"])?.id }),
  head: () => ({ meta: [{ title: "Paramètres — CampusMarket" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const section: Section = search.section ?? "general";
  const [sub, setSub] = useState<SecuritySub>("menu");
  const goSection = (s: Section) => { setSub("menu"); void navigate({ search: { section: s } }); };

  return (
    <div>
      <PageHeader kicker="Mon espace" title="Paramètres" description="Gérez votre apparence, votre confidentialité et la sécurité de votre compte." breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Mon profil", to: "/profil" }, { label: "Paramètres" }]} />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Sections des paramètres" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:sticky lg:top-24 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0">
          {sections.map(({ id, label, icon: Icon }) => (
            <button key={id} aria-current={section === id ? "page" : undefined} onClick={() => goSection(id)} className={cn("flex shrink-0 items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-semibold transition lg:w-full", section === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")}><Icon className="size-[18px]" />{label}</button>
          ))}
        </nav>
        <div className="min-w-0">
          {section === "general" && <div className="space-y-5"><GeneralSection /><InstallApp /></div>}
          {section === "confidentialite" && <PrivacySection />}
          {section === "notifications" && <div className="max-w-2xl"><NotificationPreferences /></div>}
          {section === "securite" && <SecuritySection sub={sub} setSub={setSub} goDevices={() => goSection("appareils")} />}
          {section === "appareils" && <DevicesSection />}
          {section === "compte" && <AccountSection />}
        </div>
      </div>
    </div>
  );
}
