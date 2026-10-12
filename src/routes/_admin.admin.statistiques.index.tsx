import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { ServerErrorScreen } from "@/components/cm/screens";
import { StateSwitcher } from "@/components/cm/state-switcher";
import { PageHeader } from "@/components/layout/PageHeader";
import { Download } from "@/components/icons";
import { products, categories, universities } from "@/lib/mock-data";
import { weeklyActivity } from "@/lib/mock-admin";

export const Route = createFileRoute("/_admin/admin/statistiques/")({
  head: () => ({ meta: [{ title: "Statistiques — Administration CampusMarket" }] }),
  component: AdminStatsPage,
});

type Preview = "stats" | "chargement" | "erreur";
const previews = [
  { id: "stats", label: "Statistiques" },
  { id: "chargement", label: "Chargement" },
  { id: "erreur", label: "Erreur serveur" },
] as const satisfies readonly { id: Preview; label: string }[];

const monthlyGrowth = [
  { month: "Avr", inscrits: 8200 }, { month: "Mai", inscrits: 9100 }, { month: "Juin", inscrits: 9800 },
  { month: "Juil", inscrits: 10400 }, { month: "Août", inscrits: 11600 }, { month: "Sept", inscrits: 12480 },
];
const growthConfig = { inscrits: { label: "Étudiants inscrits", color: "hsl(var(--primary))" } } satisfies ChartConfig;
const activityConfig = { inscriptions: { label: "Inscriptions", color: "hsl(var(--primary))" }, annonces: { label: "Annonces", color: "hsl(var(--primary) / 0.35)" } } satisfies ChartConfig;
const pieColors = ["hsl(var(--primary))", "hsl(var(--primary) / 0.8)", "hsl(var(--primary) / 0.6)", "hsl(var(--primary) / 0.45)", "hsl(var(--primary) / 0.3)", "hsl(var(--primary) / 0.2)", "hsl(var(--primary) / 0.12)"];

function AdminStatsPage() {
  const [preview, setPreview] = useState<Preview>("stats");

  const byCategory = useMemo(() => categories.map((c) => ({ name: c.name, value: products.filter((p) => p.category === c.slug).length })).filter((c) => c.value > 0), []);
  const categoryConfig = useMemo(() => Object.fromEntries(byCategory.map((c, i) => [c.name, { label: c.name, color: pieColors[i % pieColors.length] }])) as ChartConfig, [byCategory]);

  const byCampus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) counts.set(p.campus, (counts.get(p.campus) ?? 0) + 1);
    return Array.from(counts.entries()).map(([campus, annonces]) => ({ campus, annonces })).sort((a, b) => b.annonces - a.annonces).slice(0, 8);
  }, []);
  const campusConfig = { annonces: { label: "Annonces", color: "hsl(var(--primary))" } } satisfies ChartConfig;

  const header = <PageHeader kicker="Administration" title="Statistiques" description="Suivez la croissance et l'activité de la plateforme." breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Statistiques" }]}
    actions={<Button variant="outline" onClick={() => exportCsv(byCategory, byCampus)}><Download /> Exporter (CSV)</Button>} />;
  const switcher = <StateSwitcher states={previews} value={preview} onChange={setPreview} />;

  if (preview === "erreur") return <div>{header}{switcher}<ServerErrorScreen onRetry={() => setPreview("stats")} /></div>;
  if (preview === "chargement") return <div>{header}{switcher}<div aria-busy className="grid gap-6 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-64 animate-pulse rounded-xl bg-foreground/10" />)}</div></div>;

  return (
    <div>
      {header}{switcher}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-base font-bold">Croissance des inscriptions</h2>
          <p className="text-xs text-muted-foreground">Étudiants inscrits, 6 derniers mois</p>
          <ChartContainer config={growthConfig} className="mt-4 aspect-auto h-56 w-full">
            <LineChart data={monthlyGrowth}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line type="monotone" dataKey="inscrits" stroke="var(--color-inscrits)" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ChartContainer>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-base font-bold">Activité de la semaine</h2>
          <p className="text-xs text-muted-foreground">Inscriptions vs nouvelles annonces</p>
          <ChartContainer config={activityConfig} className="mt-4 aspect-auto h-56 w-full">
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
          <h2 className="font-display text-base font-bold">Annonces par catégorie</h2>
          <p className="text-xs text-muted-foreground">Répartition actuelle du marketplace</p>
          <ChartContainer config={categoryConfig} className="mx-auto mt-4 aspect-square h-56">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} strokeWidth={2}>
                {byCategory.map((c, i) => <Cell key={c.name} fill={pieColors[i % pieColors.length]} />)}
              </Pie>
            </PieChart>
          </ChartContainer>
          <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {byCategory.map((c, i) => <li key={c.name} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: pieColors[i % pieColors.length] }} />{c.name} ({c.value})</li>)}
          </ul>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-base font-bold">Top campus par annonces</h2>
          <p className="text-xs text-muted-foreground">{universities.length} universités partenaires</p>
          <ChartContainer config={campusConfig} className="mt-4 aspect-auto h-56 w-full">
            <BarChart data={byCampus} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <XAxis type="number" hide />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="annonces" fill="var(--color-annonces)" radius={4} />
            </BarChart>
          </ChartContainer>
        </section>
      </div>
    </div>
  );
}

function exportCsv(byCategory: { name: string; value: number }[], byCampus: { campus: string; annonces: number }[]) {
  const lines = ["Catégorie;Annonces", ...byCategory.map((c) => `${c.name};${c.value}`), "", "Campus;Annonces", ...byCampus.map((c) => `${c.campus};${c.annonces}`)];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "campusmarket-statistiques.csv"; a.click();
  URL.revokeObjectURL(url);
  toast.success("Export CSV téléchargé");
}
