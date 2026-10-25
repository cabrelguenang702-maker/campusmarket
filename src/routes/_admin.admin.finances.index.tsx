import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { InlineAlert } from "@/components/cm/feedback";
import { PageHeader } from "@/components/layout/PageHeader";
import { Coin, Receipt, Sliders, Wallet } from "@/components/icons";
import { RevenueTab } from "@/components/admin/finance/RevenueTab";
import { SettingsTab } from "@/components/admin/finance/SettingsTab";
import { PayoutsTab } from "@/components/admin/finance/PayoutsTab";
import { RefundsTab } from "@/components/admin/finance/RefundsTab";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type FinanceTab = "revenus" | "versements" | "remboursements" | "reglages";
export type AdminFinanceSearch = { onglet?: Exclude<FinanceTab, "revenus"> | undefined };

const TABS: { id: FinanceTab; label: string; icon: typeof Coin }[] = [
  { id: "revenus", label: "Revenus", icon: Coin },
  { id: "versements", label: "Versements", icon: Wallet },
  { id: "remboursements", label: "Remboursements", icon: Receipt },
  { id: "reglages", label: "Frais & réglages", icon: Sliders },
];

export const Route = createFileRoute("/_admin/admin/finances/")({
  validateSearch: (s: Record<string, unknown>): AdminFinanceSearch => ({
    onglet: s["onglet"] === "versements" || s["onglet"] === "remboursements" || s["onglet"] === "reglages" ? s["onglet"] : undefined,
  }),
  head: () => ({ meta: [{ title: "Finances — Administration CampusMarket" }] }),
  component: AdminFinancesPage,
});

function AdminFinancesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin") || roles.includes("super_admin");
  const canView = isAdmin || roles.includes("financial_manager");
  const tab: FinanceTab = search.onglet ?? "revenus";
  const goTab = (t: FinanceTab) => void navigate({ search: { onglet: t === "revenus" ? undefined : t }, replace: true });

  return (
    <div>
      <PageHeader kicker="Administration" title="Finances" description="Suivez les revenus de la plateforme, réglez les frais et commissions, et gérez les versements aux créateurs."
        breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Finances" }]} />
      {!canView ? (
        <InlineAlert tone="info">Cette section est réservée aux administrateurs et au responsable financier. La double authentification de votre compte se règle dans <Link to="/admin/securite" className="font-semibold underline">Sécurité</Link>.</InlineAlert>
      ) : (
        <>
          <div role="tablist" className="mb-6 inline-flex flex-wrap rounded-lg border border-border bg-secondary p-1">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => goTab(t.id)}
                className={cn("flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold", tab === t.id ? "bg-card shadow-soft" : "text-muted-foreground")}><t.icon className="size-4" /> {t.label}</button>
            ))}
          </div>
          {tab === "revenus" && <RevenueTab />}
          {tab === "versements" && <PayoutsTab canEdit />}
          {tab === "remboursements" && <RefundsTab canEdit={isAdmin} />}
          {tab === "reglages" && <SettingsTab canEdit={isAdmin} />}
        </>
      )}
    </div>
  );
}
