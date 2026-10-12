import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { ServerErrorScreen } from "@/components/cm/screens";
import { StateSwitcher } from "@/components/cm/state-switcher";
import { PageHeader } from "@/components/layout/PageHeader";
import { AlertTriangle, BadgeCheck, Buildings, Coin, Flag, LifeBuoy, Store, Ticket, Users } from "@/components/icons";
import { alerts, dashboardStats, reports, weeklyActivity } from "@/lib/mock-admin";
import { formatFcfa } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_admin/admin/")({
  head: () => ({ meta: [{ title: "Tableau de bord — Administration CampusMarket" }] }),
  component: AdminDashboard,
});

type Preview = "tableau" | "chargement" | "erreur";
const previews = [
  { id: "tableau", label: "Tableau de bord" },
  { id: "chargement", label: "Chargement" },
  { id: "erreur", label: "Erreur serveur" },
] as const satisfies readonly { id: Preview; label: string }[];

const chartConfig = { inscriptions: { label: "Inscriptions", color: "hsl(var(--primary))" }, annonces: { label: "Annonces", color: "hsl(var(--primary) / 0.35)" } } satisfies ChartConfig;
const alertTone = { danger: "border-destructive/30 bg-destructive/10 text-destructive", warning: "border-warning/30 bg-warning/10 text-warning", info: "border-primary/30 bg-primary/10 text-primary" } as const;

function AdminDashboard() {
  const [preview, setPreview] = useState<Preview>("tableau");
  const s = dashboardStats();
  const pendingReports = reports.filter((r) => r.status === "en_attente");

  const header = <PageHeader kicker="Administration" title="Tableau de bord" description="Vue d'ensemble de l'activité de la plateforme." breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Tableau de bord" }]} />;
  const switcher = <StateSwitcher states={previews} value={preview} onChange={setPreview} />;

  if (preview === "erreur") return <div>{header}{switcher}<ServerErrorScreen onRetry={() => setPreview("tableau")} /></div>;
  if (preview === "chargement") return <div>{header}{switcher}<div aria-busy className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-foreground/10" />)}</div></div>;

  const cards = [
    { label: "Étudiants inscrits", value: s.users.toLocaleString("fr-FR"), icon: Users },
    { label: "Universités partenaires", value: String(s.universities), icon: Buildings },
    { label: "Annonces actives", value: String(s.listings), icon: Store },
    { label: "Événements listés", value: String(s.events), icon: Ticket },
    { label: "Tickets support ouverts", value: String(s.openTickets), icon: LifeBuoy },
    { label: "Signalements en attente", value: String(s.pendingReports), icon: Flag },
    { label: "Volume Mobile Money (30 j)", value: formatFcfa(s.revenueFcfa), icon: Coin },
  ];

  return (
    <div>
      {header}{switcher}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-card p-4">
            <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><c.icon className="size-5" /></span>
            <p className="mt-3 font-display text-2xl font-bold">{c.value}</p>
            <p className="text-xs text-muted-foreground">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-base font-bold">Activité de la semaine</h2>
          <ChartContainer config={chartConfig} className="mt-4 aspect-auto h-64 w-full">
            <BarChart data={weeklyActivity}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="inscriptions" fill="var(--color-inscriptions)" radius={4} />
              <Bar dataKey="annonces" fill="var(--color-annonces)" radius={4} />
            </BarChart>
          </ChartContainer>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-base font-bold"><AlertTriangle className="size-5 text-primary" /> Alertes</h2>
          <ul className="space-y-2.5">
            {alerts.map((a) => (
              <li key={a.id} className={cn("rounded-lg border p-3", alertTone[a.tone])}>
                <p className="text-sm font-semibold">{a.title}</p>
                <p className="mt-0.5 text-xs opacity-90">{a.description}</p>
                <p className="mt-1.5 text-[11px] opacity-70">{a.time}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-base font-bold"><Flag className="size-5 text-primary" /> Signalements récents</h2>
          <AppLink to="/admin/annonces" className="text-sm font-semibold text-primary hover:underline">Tout voir</AppLink>
        </div>
        {pendingReports.length === 0 ? <p className="text-sm text-muted-foreground">Aucun signalement en attente.</p> : (
          <ul className="divide-y divide-border">
            {pendingReports.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive"><Flag className="size-4" /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{r.targetLabel}</p><p className="truncate text-xs text-muted-foreground">{r.reason} · signalé par {r.reporterName}</p></div>
                <Pill tone="warning">{r.createdLabel}</Pill>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-6 flex items-center gap-3 rounded-xl border border-dashed border-border p-4">
        <BadgeCheck className="size-5 shrink-0 text-primary" />
        <p className="flex-1 text-sm text-muted-foreground">Gérez les comptes étudiants, leurs vérifications et leurs éventuelles suspensions.</p>
        <Button asChild variant="outline"><AppLink to="/admin/utilisateurs">Gérer les utilisateurs</AppLink></Button>
      </div>
    </div>
  );
}
