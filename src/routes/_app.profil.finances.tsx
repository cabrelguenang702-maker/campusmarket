import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/cm/feedback";
import { NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAuth } from "@/lib/auth";
import { formatFcfa } from "@/lib/domain";
import { isNetworkError } from "@/lib/api/errors";
import { useSellerFinance } from "@/lib/api/orders";

export const Route = createFileRoute("/_app/profil/finances")({
  head: () => ({ meta: [{ title: "Mon tableau financier — CampusMarket" }] }),
  component: FinancePage,
});

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-display text-xl font-bold">{value}</p>{hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}</div>;
}

function FinancePage() {
  const { session } = useAuth();
  const q = useSellerFinance(session?.user.id);
  if (q.isLoading) return <div aria-busy className="mx-auto h-64 max-w-3xl animate-pulse rounded-xl bg-foreground/10" />;
  if (q.isError) return isNetworkError(q.error) ? <NetworkErrorScreen onRetry={() => void q.refetch()} /> : <ServerErrorScreen onRetry={() => void q.refetch()} />;
  const f = q.data!;
  const max = Math.max(1, ...f.monthly.map((m) => m.amount));
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <PageHeader kicker="Mes ventes" title="Tableau financier" breadcrumbs={[{ label: "Mon profil", to: "/profil" }, { label: "Tableau financier" }]} description="Montants hors frais de service (payés par l'acheteur)." />
      <div className="mb-4"><InlineAlert tone="info">Ce tableau suit vos ventes d'articles. Vos soldes à recevoir, votre compte Mobile Money et vos versements sont dans <Link to="/profil/gains" className="font-semibold underline">Mes gains</Link>.</InlineAlert></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Ventes terminées" value={formatFcfa(f.totals.completed)} hint={`${f.totals.ordersCompleted} commande(s)`} />
        <Stat label="30 derniers jours" value={formatFcfa(f.totals.last30)} />
        <Stat label="En attente de clôture" value={formatFcfa(f.totals.pending)} hint={`${f.totals.ordersPending} commande(s) payée(s)`} />
        <Stat label="Bloqué en litige" value={formatFcfa(f.totals.disputed)} hint={`${f.totals.ordersDisputed} litige(s)`} />
      </div>
      <section className="mt-6" aria-label="Ventes par mois">
        <h2 className="mb-3 font-display text-base font-bold">6 derniers mois</h2>
        <ul className="space-y-2">
          {f.monthly.map((m) => (
            <li key={m.month} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 text-xs text-muted-foreground">{m.month}</span>
              <span className="h-3 flex-1 rounded bg-secondary"><span className="block h-3 rounded bg-primary" style={{ width: `${Math.round((m.amount / max) * 100)}%` }} /></span>
              <span className="w-24 shrink-0 text-right font-semibold">{formatFcfa(m.amount)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-6">
        <h2 className="mb-3 font-display text-base font-bold">Articles les plus vendus</h2>
        {f.top.length === 0 ? <p className="text-sm text-muted-foreground">Pas encore de vente terminée.</p> : (
          <ul className="divide-y rounded-xl border bg-card">{f.top.map((t, i) => <li key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="truncate">{t.product ?? "Annonce supprimée"} <span className="text-xs text-muted-foreground">× {t.units}</span></span><span className="font-semibold">{formatFcfa(t.amount)}</span></li>)}</ul>
        )}
      </section>
      <p className="mt-6 text-xs text-muted-foreground">{f.totals.ordersTotal} commande(s) au total · {f.totals.ordersCancelled} annulée(s). <Button asChild variant="link" size="sm" className="h-auto p-0"><Link to="/profil" search={{ onglet: "ventes" }}>Retour aux ventes</Link></Button></p>
    </div>
  );
}
