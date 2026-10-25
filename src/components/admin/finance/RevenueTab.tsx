import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyScreen, ServerErrorScreen } from "@/components/cm/screens";
import { Download } from "@/components/icons";
import { formatFcfa } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { ENTRIES_PAGE, REVENUE_LABEL, periodOf, useRevenueEntries, useRevenueSummary, type RevenueKind, type RevenueSummary } from "@/lib/api/admin-finance";
import { Stat, csvCell, downloadCsv, skeleton, timeFmt } from "./shared";

const chartConfig = { revenue: { label: "Revenu net", color: "hsl(var(--primary))" } } satisfies ChartConfig;
const PERIODS = [{ days: 7, label: "7 jours" }, { days: 30, label: "30 jours" }, { days: 90, label: "90 jours" }] as const;
const ALL_KINDS = "all";

function variation(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "Stable" : "Nouveau";
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  return `${pct > 0 ? "+" : ""}${pct} % par rapport à la période précédente`;
}

function exportSummary(s: RevenueSummary) {
  downloadCsv("campusmarket-revenus.csv", [
    `Période du ${s.from} au ${s.to} (UTC), montants en FCFA`,
    "Revenus par type", ["Type", "Transactions", "Volume", "Revenu net"].map(csvCell).join(";"),
    ...s.byKind.map((k) => [REVENUE_LABEL[k.kind], k.transactions, k.volume, k.revenue].map(csvCell).join(";")),
    "", "Revenu net par jour", ["Jour", "Revenu net"].map(csvCell).join(";"),
    ...s.daily.map((d) => [d.day, d.revenue].map(csvCell).join(";")),
  ]);
  toast.success("Export CSV téléchargé");
}

export function RevenueTab() {
  const [days, setDays] = useState<number>(30);
  const [kind, setKind] = useState<RevenueKind | null>(null);
  const [offset, setOffset] = useState(0);
  const { from, to } = useMemo(() => periodOf(days), [days]);
  const summary = useRevenueSummary(from, to);
  const entries = useRevenueEntries(from, to, kind, offset);

  if (summary.isPending) return skeleton;
  if (summary.isError || !summary.data) return <ServerErrorScreen compact onRetry={() => void summary.refetch()} />;
  const s = summary.data;
  const hasData = s.transactions > 0 || s.netRevenue !== 0;
  const creatorTotal = (Object.values(s.creatorNet) as (number | undefined)[]).reduce<number>((a, b) => a + (b ?? 0), 0);
  const page = entries.data;
  const total = page?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Période" className="inline-flex rounded-lg border border-border bg-secondary p-1">
          {PERIODS.map((p) => (
            <button key={p.days} role="tab" aria-selected={days === p.days} onClick={() => { setDays(p.days); setOffset(0); }}
              className={cn("rounded-md px-3.5 py-1.5 text-sm font-semibold", days === p.days ? "bg-card shadow-soft" : "text-muted-foreground")}>{p.label}</button>
          ))}
        </div>
        <Button variant="outline" onClick={() => exportSummary(s)} disabled={!hasData}><Download /> Exporter (CSV)</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Revenu net de la plateforme" value={formatFcfa(s.netRevenue)} hint={variation(s.netRevenue, s.previousNet)} tone={s.netRevenue > 0 ? "good" : "default"} />
        <Stat label="Volume traité (paiements réussis)" value={formatFcfa(s.processedVolume)} hint="Tout l'argent encaissé par Mobile Money, parts des créateurs comprises." />
        <Stat label="Remboursé" value={formatFcfa(s.refunded)} hint="Revenu annulé par des remboursements." tone={s.refunded > 0 ? "warn" : "default"} />
        <Stat label="Transactions" value={s.transactions.toLocaleString("fr-FR")} hint={`Volume concerné : ${formatFcfa(s.volume)}`} />
      </div>

      {!hasData ? (
        <EmptyScreen compact title="Aucun revenu sur cette période" description="Les revenus apparaissent ici dès qu'un paiement est réussi : frais de service, commissions, mises en avant, abonnements." />
      ) : (
        <>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-display text-base font-bold">Revenu net par jour</h2>
            <p className="text-xs text-muted-foreground">Du {s.from} au {s.to} (heure UTC)</p>
            <ChartContainer config={chartConfig} className="mt-4 aspect-auto h-56 w-full">
              <BarChart data={s.daily}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
              </BarChart>
            </ChartContainer>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-display text-base font-bold">Revenus par type</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="py-2 pr-3 font-semibold">Type</th><th className="py-2 pr-3 text-right font-semibold">Transactions</th><th className="py-2 pr-3 text-right font-semibold">Volume</th><th className="py-2 text-right font-semibold">Revenu net</th></tr></thead>
                <tbody>
                  {s.byKind.map((k) => (
                    <tr key={k.kind} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 pr-3 font-medium">{REVENUE_LABEL[k.kind]}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{k.transactions}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{formatFcfa(k.volume)}</td>
                      <td className="py-2.5 text-right font-semibold tabular-nums">{formatFcfa(k.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {creatorTotal !== 0 && (
              <p className="mt-4 rounded-lg bg-secondary p-3 text-sm text-muted-foreground">
                <strong className="text-foreground">{formatFcfa(creatorTotal)}</strong> reviennent aux vendeurs, formateurs, organisateurs et tuteurs sur cette période (leur part après commission). Le suivi de ce qui leur est versé se fait dans l'onglet « Versements ».
              </p>
            )}
          </section>
        </>
      )}

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-bold">Détail des écritures</h2>
          <Select value={kind ?? ALL_KINDS} onValueChange={(v) => { setKind(v === ALL_KINDS ? null : (v as RevenueKind)); setOffset(0); }}>
            <SelectTrigger aria-label="Filtrer par type" className="h-9 w-full bg-background text-sm sm:w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_KINDS}>Tous les types</SelectItem>
              {(Object.keys(REVENUE_LABEL) as RevenueKind[]).map((k) => <SelectItem key={k} value={k}>{REVENUE_LABEL[k]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {entries.isPending ? <div className="mt-4">{skeleton}</div> : entries.isError ? <ServerErrorScreen compact onRetry={() => void entries.refetch()} /> : (page?.entries.length ?? 0) === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Aucune écriture pour ce filtre.</p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-border">
              {page!.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="font-medium">{REVENUE_LABEL[e.kind]}{e.isReversal && <span className="ml-2 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">Remboursement</span>}</p>
                    <p className="text-xs text-muted-foreground">{timeFmt(e.createdAt)}{e.creatorName ? ` · ${e.creatorName}` : ""}{e.ratePercent !== null && e.ratePercent > 0 ? ` · taux ${e.ratePercent} %` : ""}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Base {formatFcfa(e.baseAmount)}</p>
                  <p className={cn("w-32 text-right font-semibold tabular-nums", e.amount < 0 && "text-destructive")}>{formatFcfa(e.amount)}</p>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>{offset + 1}–{Math.min(offset + ENTRIES_PAGE, total)} sur {total}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - ENTRIES_PAGE))}>Précédent</Button>
                <Button variant="outline" size="sm" disabled={offset + ENTRIES_PAGE >= total} onClick={() => setOffset(offset + ENTRIES_PAGE)}>Suivant</Button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
