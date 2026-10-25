import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/cm/feedback";
import { EmptyScreen, NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { SubscribeDialog } from "@/components/premium/SubscribeDialog";
import { BadgeCheck, Star } from "@/components/icons";
import { useAuth } from "@/lib/auth";
import { formatDate, formatFcfa } from "@/lib/domain";
import { isNetworkError } from "@/lib/api/errors";
import { STATUS_LABEL, durationLabel, useMySubscription, useSellerPlans, type SellerPlan } from "@/lib/api/premium";

export const Route = createFileRoute("/_app/boutique-premium")({
  head: () => ({ meta: [{ title: "Boutique Premium — CampusMarket" }, { name: "description", content: "Un badge Premium sur votre boutique et aucune commission sur vos ventes pendant la durée de l'abonnement." }] }),
  component: PremiumPage,
});

const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

function PremiumPage() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const plans = useSellerPlans();
  const mine = useMySubscription(userId);
  const [chosen, setChosen] = useState<SellerPlan | null>(null);

  if (plans.isPending || mine.isPending) return <div aria-busy className="mx-auto h-64 max-w-3xl animate-pulse rounded-xl bg-foreground/10" />;
  if (plans.isError || mine.isError) {
    const err = plans.error ?? mine.error;
    if (err instanceof Error && err.name === "UserFacingError") return <div className="mx-auto max-w-3xl px-4 py-6"><InlineAlert tone="warning">{err.message}</InlineAlert></div>;
    const retry = () => { void plans.refetch(); void mine.refetch(); };
    return isNetworkError(err) ? <NetworkErrorScreen onRetry={retry} /> : <ServerErrorScreen onRetry={retry} />;
  }
  const sub = mine.data;
  const list = plans.data;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <PageHeader kicker="Vendre" title="Boutique Premium" breadcrumbs={[{ label: "Mon profil", to: "/profil" }, { label: "Boutique Premium" }]}
        description="Mettez votre boutique en avant et vendez sans commission pendant la durée de votre abonnement." />

      {sub.current ? (
        <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
          <span className="grid size-10 place-items-center rounded-full bg-primary/15 text-primary"><Star className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Vous êtes Premium · {sub.current.planLabel}</p>
            <p className="text-sm text-muted-foreground">Jusqu'au {formatDate(sub.current.endsAt)} ({daysLeft(sub.current.endsAt)} jour{daysLeft(sub.current.endsAt) > 1 ? "s" : ""} restant{daysLeft(sub.current.endsAt) > 1 ? "s" : ""}).</p>
          </div>
        </div>
      ) : sub.pending ? (
        <div className="mb-5"><InlineAlert tone="info" title="Paiement en attente">Votre formule « {sub.pending.planLabel} » ({formatFcfa(sub.pending.amount)}) n'a pas encore été payée. Choisissez-la ci-dessous pour terminer le paiement.</InlineAlert></div>
      ) : null}

      <section aria-label="Ce que comprend Premium" className="mb-6 rounded-xl border bg-card p-4">
        <h2 className="mb-2 font-display text-base font-bold">Ce que comprend Premium</h2>
        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2"><BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary" /> Un badge « Premium » visible sur votre boutique.</li>
          <li className="flex items-start gap-2"><BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary" /> Aucune commission vendeur sur vos ventes pendant la période d'abonnement (si une commission est appliquée par la plateforme).</li>
          <li className="flex items-start gap-2"><BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary" /> Les abonnements successifs s'enchaînent : renouveler avant la fin ne fait perdre aucun jour.</li>
        </ul>
      </section>

      <section aria-label="Formules">
        <h2 className="mb-3 font-display text-base font-bold">{sub.current ? "Prolonger mon abonnement" : "Choisir une formule"}</h2>
        {list.length === 0 ? (
          <EmptyScreen compact title="Aucune formule pour l'instant" description="L'abonnement Premium n'est pas encore ouvert. Revenez bientôt." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-3">
            {list.map((p) => (
              <li key={p.id} className="flex flex-col rounded-xl border bg-card p-4">
                <p className="text-sm font-semibold">{p.label}</p>
                <p className="mt-1 font-display text-2xl font-bold">{formatFcfa(p.price)}</p>
                <p className="text-xs text-muted-foreground">pour {durationLabel(p.days)}</p>
                <Button className="mt-4" variant={sub.current ? "outline" : "default"} onClick={() => setChosen(p)}>{sub.current ? "Prolonger" : "Choisir"}</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sub.history.length > 0 && (
        <section className="mt-6" aria-label="Historique">
          <h2 className="mb-3 font-display text-base font-bold">Historique</h2>
          <ul className="divide-y rounded-xl border bg-card">
            {sub.history.map((h, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold">{h.planLabel}</span>
                  <span className="block text-xs text-muted-foreground">{h.startsAt && h.endsAt ? `${formatDate(h.startsAt)} → ${formatDate(h.endsAt)}` : h.paidAt ? formatDate(h.paidAt) : "—"} · {STATUS_LABEL[h.status] ?? h.status}</span>
                </span>
                <span className="shrink-0 font-semibold">{formatFcfa(h.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SubscribeDialog plan={chosen} onClose={() => setChosen(null)} />
    </div>
  );
}
