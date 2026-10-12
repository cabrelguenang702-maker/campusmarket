import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowRight, Check, CheckCircle, Clock, CreditCard, RefreshCw, Smartphone } from "@/components/icons";
import { AuthPage, IconBadge } from "@/components/auth/AuthPage";
import { InlineAlert, Spinner } from "@/components/cm/feedback";
import { Field, PhoneField, SelectableCard } from "@/components/cm/forms";
import { StateScreen } from "@/components/cm/feedback";
import { formatFcfa, paymentMethods, REGISTRATION_FEE } from "@/lib/mock-data";
import { useOnboarding } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_auth/inscription/paiement")({
  head: () => ({ meta: [{ title: "Paiement de l'inscription — CampusMarket" }] }),
  component: PaymentPage,
});

type State = "choix" | "attente-mtn" | "attente-orange" | "confirme" | "echec" | "expire";
const states = [
  { id: "choix", label: "Choix du paiement" },
  { id: "attente-mtn", label: "MTN MoMo — attente" },
  { id: "attente-orange", label: "Orange Money — redirection" },
  { id: "confirme", label: "Paiement confirmé" },
  { id: "echec", label: "Paiement échoué" },
  { id: "expire", label: "Paiement expiré" },
] as const satisfies readonly { id: State; label: string }[];

function MethodTile({ id }: { id: "mtn" | "orange" }) {
  return id === "mtn" ? (
    <span className="grid size-11 shrink-0 place-items-center rounded-md text-[11px] font-extrabold" style={{ background: "#FFCC00", color: "#111" }}>MTN</span>
  ) : (
    <span className="grid size-11 shrink-0 place-items-center rounded-md text-[11px] font-extrabold" style={{ background: "#FF7900", color: "#fff" }}>OM</span>
  );
}

function useCountdown(active: boolean, from: number) {
  const [left, setLeft] = useState(from);
  useEffect(() => { setLeft(from); }, [active, from]);
  useEffect(() => {
    if (!active || left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [active, left]);
  return `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
}

function PaymentPage() {
  const navigate = useNavigate();
  const { country, phone, setPhone, method, setMethod } = useOnboarding();
  const [state, setState] = useState<State>("choix");
  const pending = state === "attente-mtn" || state === "attente-orange";
  const countdown = useCountdown(pending, 300);
  const chosen = paymentMethods.find((m) => m.id === method) ?? paymentMethods[0];
  const fullPhone = `${country.dial} ${phone || "6 XX XX XX XX"}`;

  const pay = () => setState(method === "mtn" ? "attente-mtn" : "attente-orange");

  /* ---------- Attente MTN MoMo ---------- */
  if (state === "attente-mtn") {
    return (
      <AuthPage title="Validez le paiement sur votre téléphone" description={`Une demande de ${formatFcfa(REGISTRATION_FEE)} vient d'être envoyée au ${fullPhone}.`} states={states} state={state} onStateChange={setState}
        icon={<span className="relative grid size-16 place-items-center rounded-2xl bg-primary/12 text-primary"><Smartphone className="size-8" /><span className="absolute -inset-1 animate-ping rounded-2xl border-2 border-primary/30" /></span>}>
        <ol className="space-y-3">
          {["Ouvrez la notification MTN Mobile Money reçue par SMS ou USSD.", "Saisissez votre code PIN pour confirmer le paiement.", "Restez sur cette page : nous validons automatiquement."].map((t, i) => (
            <li key={t} className="flex gap-3 text-sm"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/12 text-xs font-bold text-primary">{i + 1}</span><span className="pt-0.5">{t}</span></li>
          ))}
        </ol>
        <div className="mt-5 flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <span className="flex items-center gap-2 text-muted-foreground"><Spinner className="size-4" /> En attente de confirmation…</span>
          <span className="flex items-center gap-1.5 font-semibold tabular-nums"><Clock className="size-4 text-muted-foreground" />{countdown}</span>
        </div>
        <InlineAlert tone="info" className="mt-4">Pas de demande reçue ? Composez <span className="font-semibold">*126#</span> puis choisissez « Approbations ».</InlineAlert>
        <Button size="lg" className="mt-6 w-full" onClick={() => setState("confirme")}>J'ai validé le paiement</Button>
        <Button size="lg" variant="ghost" className="mt-2 w-full" onClick={() => setState("choix")}>Annuler</Button>
      </AuthPage>
    );
  }

  /* ---------- Attente / redirection Orange Money ---------- */
  if (state === "attente-orange") {
    return (
      <AuthPage title="Redirection vers Orange Money" description="Terminez le paiement dans l'application ou le service Orange Money, puis revenez ici." states={states} state={state} onStateChange={setState}
        icon={<span className="grid size-16 place-items-center rounded-2xl text-lg font-extrabold" style={{ background: "#FF7900", color: "#fff" }}>OM</span>}>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Montant à régler</span><span className="font-display text-lg font-bold">{formatFcfa(REGISTRATION_FEE)}</span></div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-2/3 animate-pulse rounded-full bg-primary" /></div>
          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="size-3.5" /> Ouverture d'Orange Money… <span className="ml-auto tabular-nums">{countdown}</span></p>
        </div>
        <Button size="lg" className="mt-5 w-full" style={{ background: "#FF7900", color: "#fff" }}>Ouvrir Orange Money <ArrowRight /></Button>
        <InlineAlert tone="info" className="mt-4">La page ne s'ouvre pas ? Composez <span className="font-semibold">#150#</span> et validez le paiement avec votre code secret.</InlineAlert>
        <Button size="lg" variant="outline" className="mt-4 w-full" onClick={() => setState("confirme")}>J'ai validé le paiement</Button>
        <Button size="lg" variant="ghost" className="mt-2 w-full" onClick={() => setState("choix")}>Annuler</Button>
      </AuthPage>
    );
  }

  /* ---------- Résultats ---------- */
  if (state === "confirme") {
    return (
      <AuthPage title="Paiement confirmé" states={states} state={state} onStateChange={setState}>
        <StateScreen compact icon={CheckCircle} tone="success" title="Merci, c'est réglé !" description="Votre inscription est payée. Il ne reste plus qu'à créer votre compte." className="pt-2" />
        <dl className="mt-2 divide-y divide-border rounded-lg border border-border bg-card text-sm">
          {[["Montant", formatFcfa(REGISTRATION_FEE)], ["Moyen de paiement", chosen?.name ?? ""], ["Numéro", fullPhone], ["Référence", "CM-2026-004821"]].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>
          ))}
        </dl>
        <Button size="lg" className="mt-6 w-full" onClick={() => navigate({ to: "/inscription/compte-cree" })}>Finaliser mon compte <ArrowRight /></Button>
      </AuthPage>
    );
  }

  if (state === "echec") {
    return (
      <AuthPage title="Paiement échoué" states={states} state={state} onStateChange={setState}>
        <StateScreen compact icon={AlertCircle} tone="danger" title="Le paiement n'a pas abouti" description="Aucun montant n'a été débité. Voici les causes les plus fréquentes :" className="pt-2" />
        <ul className="mb-2 space-y-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          {["Solde insuffisant sur votre compte Mobile Money", "Code PIN incorrect ou saisi trop tard", "Paiement refusé par l'opérateur"].map((t) => <li key={t} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-destructive" />{t}</li>)}
        </ul>
        <Button size="lg" className="mt-4 w-full" onClick={pay}><RefreshCw /> Réessayer</Button>
        <Button size="lg" variant="outline" className="mt-2 w-full" onClick={() => setState("choix")}>Changer de moyen de paiement</Button>
      </AuthPage>
    );
  }

  if (state === "expire") {
    return (
      <AuthPage title="Paiement expiré" states={states} state={state} onStateChange={setState}>
        <StateScreen compact icon={Clock} tone="warning" title="La demande a expiré" description="Vous n'avez pas validé le paiement dans le délai imparti. Aucun montant n'a été débité." className="pt-2" />
        <Button size="lg" className="mt-4 w-full" onClick={pay}><RefreshCw /> Relancer le paiement</Button>
        <Button size="lg" variant="ghost" className="mt-2 w-full" onClick={() => setState("choix")}>Changer de moyen de paiement</Button>
      </AuthPage>
    );
  }

  /* ---------- Choix du moyen de paiement ---------- */
  return (
    <AuthPage step={5} back="/inscription/universite" title="Finalisez votre inscription" description="Un paiement unique active votre compte étudiant CampusMarket." icon={<IconBadge icon={CreditCard} />} states={states} state={state} onStateChange={setState}>
      <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
        <div className="flex items-end justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Frais d'inscription</p><p className="mt-1 font-display text-3xl font-bold text-primary">{formatFcfa(REGISTRATION_FEE)}</p></div>
          <span className="rounded-full bg-primary/12 px-2.5 py-1 text-[11px] font-bold text-primary">Paiement unique</span>
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          {["Accès à la marketplace, aux formations et aux communautés", "Profil étudiant avec badge de vérification", "Messagerie et paiements sécurisés"].map((t) => (
            <li key={t} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" />{t}</li>
          ))}
        </ul>
      </div>

      <p className="mb-2 mt-6 text-sm font-semibold">Payer avec</p>
      <div className="space-y-2.5" role="radiogroup" aria-label="Moyen de paiement">
        {paymentMethods.map((m) => (
          <SelectableCard key={m.id} selected={method === m.id} onSelect={() => setMethod(m.id)} title={m.name} description={m.hint} trailing={<MethodTile id={m.id} />} />
        ))}
      </div>

      <Field className="mt-5" label="Numéro Mobile Money" htmlFor="momo" hint="Nous enverrons la demande de paiement à ce numéro.">
        <PhoneField id="momo" country={country} value={phone} onChange={setPhone} />
      </Field>

      <Button size="lg" className={cn("mt-6 w-full")} onClick={pay}>Payer {formatFcfa(REGISTRATION_FEE)}</Button>
      <p className="mt-3 text-center text-[11px] text-muted-foreground">Paiement sécurisé · Aucun frais caché</p>
    </AuthPage>
  );
}
