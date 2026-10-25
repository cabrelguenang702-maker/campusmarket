import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { AlertTriangle, BadgeCheck, Buildings, Coin, Flag, LifeBuoy, Store, Ticket, Users } from "@/components/icons";
import { formatFcfa, timeAgo } from "@/lib/domain";
import { useAdminAlerts, useDashboardStats, useWeeklyActivity } from "@/lib/api/admin-stats";
import { useReports } from "@/lib/api/admin-listings";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_admin/admin/")({
  head: () => ({ meta: [{ title: "Tableau de bord — Administration CampusMarket" }] }),
  component: AdminDashboard,
});

const chartConfig = { signups: { label: "Inscriptions", color: "hsl(var(--primary))" }, listings: { label: "Annonces", color: "hsl(var(--primary) / 0.35)" } } satisfies ChartConfig;
const alertTone = { danger: "border-destructive/30 bg-destructive/10 text-destructive", warning: "border-warning/30 bg-warning/10 text-warning", info: "border-primary/30 bg-primary/10 text-primary" } as const;

function AdminDashboard() {
  const stats = useDashboardStats();
  const weekly = useWeeklyActivity();
  const alerts = useAdminAlerts();
  const reports = useReports({ open: true, page: 0 });
  const pendingReports = (reports.data?.rows ?? []).filter((r) => r.status === "pending").slice(0, 5);

  const header = <PageHeader kicker="Administration" title="Tableau de bord" description="Vue d'ensemble de l'activité de la plateforme." breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Tableau de bord" }]} />;

  if (stats.isPending) return <div>{header}<div aria-busy className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-foreground/10" />)}</div></div>;
  if (stats.isError) return <div>{header}<ServerErrorScreen onRetry={() => void stats.refetch()} /></div>;

  const s = stats.data;
  const cards: { label: string; value: string; icon: typeof Users; to?: string }[] = [
    { label: "Étudiants inscrits", value: s.users.toLocaleString("fr-FR"), icon: Users, to: "/admin/utilisateurs" },
    { label: "Universités actives", value: String(s.universities), icon: Buildings, to: "/admin/geographie" },
    { label: "Annonces publiées", value: String(s.listings), icon: Store, to: "/admin/annonces" },
    { label: "Événements publiés", value: String(s.events), icon: Ticket },
    { label: "Tickets support ouverts", value: String(s.openTickets), icon: LifeBuoy, to: "/admin/support" },
    { label: "Signalements en attente", value: String(s.pendingReports), icon: Flag, to: "/admin/annonces" },
    ...(s.mobileMoneyVolume30d !== null ? [{ label: "Volume Mobile Money (30 j)", value: formatFcfa(s.mobileMoneyVolume30d), icon: Coin }] : []),
  ];

  return (
    <div>
      {header}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => {
          const inner = (
            <>
              <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><c.icon className="size-5" /></span>
              <p className="mt-3 font-display text-2xl font-bold">{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </>
          );
          return c.to
            ? <AppLink key={c.label} to={c.to} className="rounded-xl border border-border bg-card p-4 transition hover:border-primary/40">{inner}</AppLink>
            : <div key={c.label} className="rounded-xl border border-border bg-card p-4">{inner}</div>;
        })}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-base font-bold">Activité de la semaine</h2>
          <p className="text-xs text-muted-foreground">Inscriptions et nouvelles annonces, 7 derniers jours</p>
          {weekly.isPending ? <div className="mt-4 h-64 animate-pulse rounded-lg bg-foreground/10" /> : weekly.isError ? (
            <p className="mt-4 text-sm text-destructive">Activité indisponible. <button className="font-semibold underline" onClick={() => void weekly.refetch()}>Réessayer</button></p>
          ) : (
            <ChartContainer config={chartConfig} className="mt-4 aspect-auto h-64 w-full">
              <BarChart data={weekly.data}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="signups" fill="var(--color-signups)" radius={4} />
                <Bar dataKey="listings" fill="var(--color-listings)" radius={4} />
              </BarChart>
            </ChartContainer>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-base font-bold"><AlertTriangle className="size-5 text-primary" /> Alertes</h2>
          {alerts.isPending ? <div className="h-24 animate-pulse rounded-lg bg-foreground/10" /> : alerts.isError ? (
            <p className="text-sm text-destructive">Alertes indisponibles. <button className="font-semibold underline" onClick={() => void alerts.refetch()}>Réessayer</button></p>
          ) : (alerts.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Aucune alerte : tout est calme.</p> : (
            <ul className="space-y-2.5">
              {(alerts.data ?? []).map((a) => (
                <li key={a.id} className={cn("rounded-lg border p-3", alertTone[a.tone])}>
                  <p className="text-sm font-semibold">{a.title}</p>
                  <p className="mt-0.5 text-xs opacity-90">{a.description}</p>
                  <p className="mt-1.5 text-[11px] opacity-70">{timeAgo(a.detectedAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-base font-bold"><Flag className="size-5 text-primary" /> Signalements à traiter</h2>
          <AppLink to="/admin/annonces" search={{ onglet: "signalements" }} className="text-sm font-semibold text-primary hover:underline">Tout voir</AppLink>
        </div>
        {reports.isPending ? <div className="h-16 animate-pulse rounded-lg bg-foreground/10" /> : reports.isError ? (
          <p className="text-sm text-destructive">Signalements indisponibles. <button className="font-semibold underline" onClick={() => void reports.refetch()}>Réessayer</button></p>
        ) : pendingReports.length === 0 ? <p className="text-sm text-muted-foreground">Aucun signalement en attente.</p> : (
          <ul className="divide-y divide-border">
            {pendingReports.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive"><Flag className="size-4" /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{r.targetLabel}</p><p className="truncate text-xs text-muted-foreground">{r.reason} · signalé par {r.reporterName}</p></div>
                <Pill tone="warning">{timeAgo(r.createdAt)}</Pill>
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
