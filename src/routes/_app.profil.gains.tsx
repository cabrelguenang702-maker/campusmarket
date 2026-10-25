import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/cm/forms";
import { InlineAlert } from "@/components/cm/feedback";
import { NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAuth } from "@/lib/auth";
import { formatDate, formatFcfa } from "@/lib/domain";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { KIND_LABEL, PROVIDER_LABEL, maskPhone, useEarnings, useSavePayoutAccount, type PayoutProvider } from "@/lib/api/earnings";

export const Route = createFileRoute("/_app/profil/gains")({
  head: () => ({ meta: [{ title: "Mes gains — CampusMarket" }, { name: "description", content: "Vos soldes, votre compte de versement Mobile Money et l'historique de vos versements." }] }),
  component: EarningsPage,
});

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${strong ? "border-primary/40 bg-primary/5" : "bg-card"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-xl font-bold">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PayoutAccountForm({ userId, current }: { userId: string; current: { provider: PayoutProvider; phone: string; holderName: string } | null }) {
  const save = useSavePayoutAccount(userId);
  const [editing, setEditing] = useState(current === null);
  const [provider, setProvider] = useState<PayoutProvider>(current?.provider ?? "mtn_momo");
  const [phone, setPhone] = useState(current?.phone ?? "+237");
  const [holder, setHolder] = useState(current?.holderName ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setEditing(current === null); }, [current]);

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({ provider, phone: phone.replace(/[\s.-]/g, ""), holderName: holder.trim() });
      toast.success("Compte de versement enregistré");
      setEditing(false);
    } catch (e) { setError(friendlyError(e)); }
  };

  if (!editing && current) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div>
          <p className="font-semibold">{PROVIDER_LABEL[current.provider]}</p>
          <p className="text-sm text-muted-foreground">{maskPhone(current.phone)} · {current.holderName}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setProvider(current.provider); setPhone(current.phone); setHolder(current.holderName); setEditing(true); }}>Modifier</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <Field label="Opérateur" htmlFor="payout-provider">
        <Select value={provider} onValueChange={(v) => setProvider(v as PayoutProvider)}>
          <SelectTrigger id="payout-provider"><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(PROVIDER_LABEL) as PayoutProvider[]).map((p) => <SelectItem key={p} value={p}>{PROVIDER_LABEL[p]}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Numéro Mobile Money" htmlFor="payout-phone" hint="Format international, par exemple +237 6XX XXX XXX.">
        <Input id="payout-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label="Nom du titulaire" htmlFor="payout-holder" hint="Le nom enregistré chez l'opérateur pour ce numéro.">
        <Input id="payout-holder" autoComplete="name" maxLength={80} value={holder} onChange={(e) => setHolder(e.target.value)} />
      </Field>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={() => void submit()} disabled={save.isPending || holder.trim().length < 2 || phone.replace(/[\s.-]/g, "").length < 9}>{save.isPending ? "Enregistrement…" : "Enregistrer"}</Button>
        {current && <Button variant="outline" onClick={() => { setError(null); setEditing(false); }}>Annuler</Button>}
      </div>
    </div>
  );
}

function EarningsPage() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const q = useEarnings(userId);

  if (q.isPending) return <div aria-busy className="mx-auto h-64 max-w-3xl animate-pulse rounded-xl bg-foreground/10" />;
  if (q.isError) {
    const msg = q.error instanceof Error && q.error.name === "UserFacingError" ? q.error.message : null;
    if (msg) return <div className="mx-auto max-w-3xl px-4 py-6"><InlineAlert tone="warning">{msg}</InlineAlert></div>;
    return isNetworkError(q.error) ? <NetworkErrorScreen onRetry={() => void q.refetch()} /> : <ServerErrorScreen onRetry={() => void q.refetch()} />;
  }
  const e = q.data;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <PageHeader kicker="Mon profil" title="Mes gains" breadcrumbs={[{ label: "Mon profil", to: "/profil" }, { label: "Mes gains" }]}
        description="Ce que vous avez gagné avec vos ventes, formations, événements et séances de tutorat, après commissions." />

      <div className="mb-4"><InlineAlert tone="info">Les versements sont effectués par l'équipe CampusMarket sur votre compte Mobile Money, puis enregistrés ici. Renseignez votre compte ci-dessous pour être payé.</InlineAlert></div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat strong label="Disponible" value={formatFcfa(e.available)} hint="Prêt à être versé" />
        <Stat label="En attente" value={formatFcfa(e.pending)} hint="Commande non clôturée, délai ou événement à venir" />
        <Stat label="Déjà versé" value={formatFcfa(e.paid)} />
      </div>

      <section className="mt-6" aria-label="Compte de versement">
        <h2 className="mb-3 font-display text-base font-bold">Compte de versement</h2>
        {e.available > 0 && !e.account && <div className="mb-3"><InlineAlert tone="warning">Vous avez {formatFcfa(e.available)} disponibles mais aucun compte de versement : ajoutez-le pour être payé.</InlineAlert></div>}
        {userId && <PayoutAccountForm userId={userId} current={e.account} />}
      </section>

      <section className="mt-6" aria-label="Versements reçus">
        <h2 className="mb-3 font-display text-base font-bold">Versements reçus</h2>
        {e.payouts.length === 0 ? <p className="text-sm text-muted-foreground">Aucun versement pour l'instant.</p> : (
          <ul className="divide-y rounded-xl border bg-card">
            {e.payouts.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span><span className="font-semibold">{formatDate(p.createdAt)}</span>{p.reference && <span className="ml-2 text-xs text-muted-foreground">Réf. {p.reference}</span>}</span>
                <span className="font-semibold">{formatFcfa(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6" aria-label="Dernières écritures">
        <h2 className="mb-3 font-display text-base font-bold">Dernières écritures</h2>
        {e.entries.length === 0 ? <p className="text-sm text-muted-foreground">Rien à afficher : vos gains apparaîtront après un premier paiement reçu.</p> : (
          <ul className="divide-y rounded-xl border bg-card">
            {e.entries.map((x, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold">{x.isReversal ? "Remboursement : " : ""}{KIND_LABEL[x.kind] ?? "Paiement"}</span>
                  <span className="block text-xs text-muted-foreground">{formatDate(x.createdAt)} · montant {formatFcfa(x.base)}{x.commission > 0 ? ` · commission ${formatFcfa(x.commission)}` : ""}{!x.isReversal && x.availableAt ? ` · disponible le ${formatDate(x.availableAt)}` : ""}</span>
                </span>
                <span className={`shrink-0 font-semibold ${x.net < 0 ? "text-destructive" : ""}`}>{x.net > 0 ? "+" : ""}{formatFcfa(x.net)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-xs text-muted-foreground">Ventes d'articles : <Link to="/profil/finances" className="font-semibold text-primary hover:underline">voir mon tableau financier</Link>.</p>
    </div>
  );
}
