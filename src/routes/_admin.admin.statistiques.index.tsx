import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { Download } from "@/components/icons";
import { useListingsByCategory, useSignupGrowth, useTopCampuses, useWeeklyActivity, type CampusCount, type CategoryCount, type DayActivity, type MonthGrowth } from "@/lib/api/admin-stats";

export const Route = createFileRoute("/_admin/admin/statistiques/")({
  head: () => ({ meta: [{ title: "Statistiques — Administration CampusMarket" }] }),
  component: AdminStatsPage,
});

const growthConfig = { cumulative: { label: "Étudiants inscrits", color: "hsl(var(--primary))" } } satisfies ChartConfig;
const activityConfig = { signups: { label: "Inscriptions", color: "hsl(var(--primary))" }, listings: { label: "Annonces", color: "hsl(var(--primary) / 0.35)" } } satisfies ChartConfig;
const campusConfig = { listings: { label: "Annonces", color: "hsl(var(--primary))" } } satisfies ChartConfig;
const pieColors = ["hsl(var(--primary))", "hsl(var(--primary) / 0.8)", "hsl(var(--primary) / 0.6)", "hsl(var(--primary) / 0.45)", "hsl(var(--primary) / 0.3)", "hsl(var(--primary) / 0.2)", "hsl(var(--primary) / 0.12)"];

function Card({ title, subtitle, state, children }: { title: string; subtitle: string; state: { isPending: boolean; isError: boolean; refetch: () => unknown }; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-display text-base font-bold">{title}</h2>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
      {state.isPending ? <div className="mt-4 h-56 animate-pulse rounded-lg bg-foreground/10" /> : state.isError ? (
        <p className="mt-4 text-sm text-destructive">Données indisponibles. <button className="font-semibold underline" onClick={() => void state.refetch()}>Réessayer</button></p>
      ) : children}
    </section>
  );
}

const NoData = () => <p className="mt-4 grid h-56 place-items-center text-sm text-muted-foreground">Pas encore de données.</p>;

function AdminStatsPage() {
  const growth = useSignupGrowth();
  const weekly = useWeeklyActivity();
  const categories = useListingsByCategory();
  const campuses = useTopCampuses();

  const byCategory = useMemo(() => (categories.data ?? []).filter((c) => c.listings > 0), [categories.data]);
  const categoryConfig = useMemo(() => Object.fromEntries(byCategory.map((c, i) => [c.name, { label: c.name, color: pieColors[i % pieColors.length] }])) as ChartConfig, [byCategory]);
  const pieData = useMemo(() => byCategory.map((c) => ({ name: c.name, value: c.listings })), [byCategory]);
  const ready = !!growth.data && !!weekly.data && !!categories.data && !!campuses.data;
  const allFailed = growth.isError && weekly.isError && categories.isError && campuses.isError;

  const header = (
    <PageHeader kicker="Administration" title="Statistiques" description="Suivez la croissance et l'activité de la plateforme." breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Statistiques" }]}
      actions={<Button variant="outline" disabled={!ready} onClick={() => exportCsv(growth.data!, weekly.data!, categories.data!, campuses.data!)}><Download /> Exporter (CSV)</Button>} />
  );
  if (allFailed) return <div>{header}<ServerErrorScreen onRetry={() => { void growth.refetch(); void weekly.refetch(); void categories.refetch(); void campuses.refetch(); }} /></div>;

  const weeklyHasData = (weekly.data ?? []).some((d) => d.signups > 0 || d.listings > 0);
  const growthHasData = (growth.data ?? []).some((m) => m.cumulative > 0);

  return (
    <div>
      {header}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Croissance des inscriptions" subtitle="Étudiants inscrits (cumul), 6 derniers mois" state={growth}>
          {!growthHasData ? <NoData /> : (
            <ChartContainer config={growthConfig} className="mt-4 aspect-auto h-56 w-full">
              <LineChart data={growth.data}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="cumulative" stroke="var(--color-cumulative)" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ChartContainer>
          )}
        </Card>

        <Card title="Activité de la semaine" subtitle="Inscriptions et nouvelles annonces, 7 derniers jours" state={weekly}>
          {!weeklyHasData ? <NoData /> : (
            <ChartContainer config={activityConfig} className="mt-4 aspect-auto h-56 w-full">
              <BarChart data={weekly.data}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="signups" fill="var(--color-signups)" radius={4} />
                <Bar dataKey="listings" fill="var(--color-listings)" radius={4} />
              </BarChart>
            </ChartContainer>
          )}
        </Card>

        <Card title="Annonces par catégorie" subtitle="Annonces publiées, répartition actuelle" state={categories}>
          {pieData.length === 0 ? <NoData /> : (
            <>
              <ChartContainer config={categoryConfig} className="mx-auto mt-4 aspect-square h-56">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} strokeWidth={2}>
                    {pieData.map((c, i) => <Cell key={c.name} fill={pieColors[i % pieColors.length]} />)}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {pieData.map((c, i) => <li key={c.name} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: pieColors[i % pieColors.length] }} />{c.name} ({c.value})</li>)}
              </ul>
            </>
          )}
        </Card>

        <Card title="Top campus par annonces" subtitle="Annonces publiées par campus" state={campuses}>
          {(campuses.data ?? []).length === 0 ? <NoData /> : (
            <ChartContainer config={campusConfig} className="mt-4 aspect-auto h-56 w-full">
              <BarChart data={campuses.data} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" hide />
                <ChartTooltip content={<ChartTooltipContent nameKey="campus" />} />
                <Bar dataKey="listings" fill="var(--color-listings)" radius={4} />
              </BarChart>
            </ChartContainer>
          )}
          {(campuses.data ?? []).length > 0 && <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{(campuses.data ?? []).map((c) => <li key={c.campus} className="flex justify-between"><span className="truncate">{c.campus}</span><span className="font-semibold text-foreground">{c.listings}</span></li>)}</ul>}
        </Card>
      </div>
    </div>
  );
}

/** Une cellule CSV : guillemets doublés, et une valeur qui commencerait par = + - @ est neutralisée pour qu'Excel ne l'exécute pas comme une formule. */
const cell = (v: string | number) => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

function exportCsv(growth: MonthGrowth[], weekly: DayActivity[], categories: CategoryCount[], campuses: CampusCount[]) {
  const lines = [
    "Inscriptions par mois", ["Mois", "Inscriptions", "Cumul"].map(cell).join(";"), ...growth.map((m) => [m.month, m.signups, m.cumulative].map(cell).join(";")),
    "", "Activité des 7 derniers jours", ["Jour", "Inscriptions", "Annonces"].map(cell).join(";"), ...weekly.map((d) => [d.day, d.signups, d.listings].map(cell).join(";")),
    "", "Annonces publiées par catégorie", ["Catégorie", "Annonces"].map(cell).join(";"), ...categories.map((c) => [c.name, c.listings].map(cell).join(";")),
    "", "Annonces publiées par campus", ["Campus", "Annonces"].map(cell).join(";"), ...campuses.map((c) => [c.campus, c.listings].map(cell).join(";")),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "campusmarket-statistiques.csv"; a.click();
  URL.revokeObjectURL(url);
  toast.success("Export CSV téléchargé");
}
