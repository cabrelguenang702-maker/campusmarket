import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowRight, CheckCircle, Clock, RefreshCw, Smartphone } from "@/components/icons";
import { formatFcfa, paymentMethods } from "@/lib/domain";
import type { Country } from "@/lib/mock-data";
import type { PaymentMethod, PaymentState } from "@/lib/api/payments";
import { InlineAlert, Spinner, StateScreen } from "./feedback";
import { Field, PhoneField, SelectableCard } from "./forms";

/** États du paiement Mobile Money (checkout, achat groupé, billetterie…) : définis dans lib/api/payments.ts. */
export type { PaymentMethod, PaymentState };

export const paymentStateOptions = [
  { id: "choix", label: "Choix du paiement" },
  { id: "mobile", label: "Paiement Mobile Money" },
  { id: "attente", label: "Paiement en attente" },
  { id: "confirme", label: "Paiement confirmé" },
  { id: "echec", label: "Paiement échoué" },
  { id: "expire", label: "Paiement expiré" },
] as const satisfies readonly { id: PaymentState; label: string }[];

export function MethodTile({ id, className = "size-11" }: { id: PaymentMethod; className?: string }) {
  return id === "mtn" ? (
    <span className={`grid shrink-0 place-items-center rounded-md text-[11px] font-extrabold ${className}`} style={{ background: "#FFCC00", color: "#111" }}>MTN</span>
  ) : (
    <span className={`grid shrink-0 place-items-center rounded-md text-[11px] font-extrabold ${className}`} style={{ background: "#FF7900", color: "#fff" }}>OM</span>
  );
}

export function useCountdown(active: boolean, from: number) {
  const [left, setLeft] = useState(from);
  useEffect(() => { setLeft(from); }, [active, from]);
  useEffect(() => {
    if (!active || left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [active, left]);
  return `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
}

type Props = {
  amount: number;
  state: PaymentState;
  onStateChange: (s: PaymentState) => void;
  method: PaymentMethod;
  onMethodChange: (m: PaymentMethod) => void;
  country: Country;
  phone: string;
  onPhoneChange: (v: string) => void;
  /** Appelé depuis l'écran « Paiement confirmé ». */
  onContinue: () => void;
  continueLabel?: string;
  reference?: string;
  /** Lignes du reçu affiché après confirmation. */
  receipt?: [string, string][];
  /** Branchement réel : lance la demande de paiement (sans lui, le composant reste une maquette contrôlée). */
  onPay?: () => void;
  payBusy?: boolean;
  payError?: string | null;
  /** Relit l'état de la tentative en cours (« J'ai validé le paiement »). */
  onCheck?: () => void;
  /** Quitte l'attente et revient au choix du moyen de paiement. */
  onCancel?: () => void;
};

/**
 * Parcours de paiement Mobile Money : choix du moyen → numéro → attente → résultat.
 * Composant contrôlé pour que l'écran parent puisse forcer chaque état (revue de design).
 */
export function PaymentFlow({ amount, state, onStateChange, method, onMethodChange, country, phone, onPhoneChange, onContinue, continueLabel = "Continuer", reference = "CM-2026-004821", receipt = [], onPay, payBusy = false, payError = null, onCheck, onCancel }: Props) {
  const pending = state === "attente";
  const countdown = useCountdown(pending, 300);
  const chosen = paymentMethods.find((m) => m.id === method) ?? paymentMethods[0];
  const fullPhone = `${country.dial} ${phone || "6 XX XX XX XX"}`;

  if (state === "choix") {
    return (
      <div>
        <h2 className="font-display text-lg font-bold">Choisissez votre moyen de paiement</h2>
        <p className="mt-1 text-sm text-muted-foreground">Vous réglez {formatFcfa(amount)} par Mobile Money.</p>
        <div className="mt-4 space-y-2.5" role="radiogroup" aria-label="Moyen de paiement">
          {paymentMethods.map((m) => (
            <SelectableCard key={m.id} selected={method === m.id} onSelect={() => onMethodChange(m.id)} title={m.name} description={m.hint} trailing={<MethodTile id={m.id} />} />
          ))}
          <SelectableCard selected={false} onSelect={() => {}} title="Carte bancaire" description="Bientôt disponible" disabled />
        </div>
        <Button size="lg" className="mt-6 w-full" onClick={() => onStateChange("mobile")}>Continuer <ArrowRight /></Button>
      </div>
    );
  }

  if (state === "mobile") {
    return (
      <div>
        <h2 className="font-display text-lg font-bold">Paiement {chosen?.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Nous envoyons la demande de paiement à ce numéro.</p>
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-card p-3.5">
          <MethodTile id={method} />
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{chosen?.name}</p><p className="text-xs text-muted-foreground">Montant à régler</p></div>
          <p className="font-display text-lg font-bold text-primary">{formatFcfa(amount)}</p>
        </div>
        <Field className="mt-5" label="Numéro Mobile Money" htmlFor="pay-phone" hint="Le compte doit disposer du solde nécessaire.">
          <PhoneField id="pay-phone" country={country} value={phone} onChange={onPhoneChange} />
        </Field>
        {payError && <InlineAlert tone="danger" className="mt-4" title="Le paiement n'a pas pu être lancé">{payError}</InlineAlert>}
        <Button size="lg" className="mt-6 w-full" disabled={payBusy} onClick={() => (onPay ? onPay() : onStateChange("attente"))}>{payBusy ? "Envoi de la demande…" : `Payer ${formatFcfa(amount)}`}</Button>
        <Button size="lg" variant="ghost" className="mt-2 w-full" onClick={() => onStateChange("choix")}>Changer de moyen de paiement</Button>
      </div>
    );
  }

  if (state === "attente") {
    return (
      <div>
        <div className="flex items-start gap-4">
          <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
            <Smartphone className="size-7" />
            <span className="absolute -inset-1 animate-ping rounded-2xl border-2 border-primary/30" />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold">Validez sur votre téléphone</h2>
            <p className="mt-1 text-sm text-muted-foreground">Une demande de {formatFcfa(amount)} vient d'être envoyée au {fullPhone}. Saisissez votre code secret pour la valider.</p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <span className="flex items-center gap-2 text-muted-foreground"><Spinner className="size-4" /> En attente de confirmation…</span>
          <span className="flex items-center gap-1.5 font-semibold tabular-nums"><Clock className="size-4 text-muted-foreground" />{countdown}</span>
        </div>
        <InlineAlert tone="info" className="mt-4">
          {method === "mtn" ? <>Pas de demande reçue ? Composez <span className="font-semibold">*126#</span> puis choisissez « Approbations ».</> : <>La page ne s'ouvre pas ? Composez <span className="font-semibold">#150#</span> et validez avec votre code secret.</>}
        </InlineAlert>
        <Button size="lg" className="mt-6 w-full" onClick={() => (onCheck ? onCheck() : onStateChange("confirme"))}>J'ai validé le paiement</Button>
        <Button size="lg" variant="ghost" className="mt-2 w-full" onClick={() => (onCancel ? onCancel() : onStateChange("choix"))}>Annuler</Button>
      </div>
    );
  }

  if (state === "confirme") {
    const rows: [string, string][] = [["Montant", formatFcfa(amount)], ["Moyen de paiement", chosen?.name ?? ""], ["Numéro", fullPhone], ...receipt, ["Référence", reference]];
    return (
      <div>
        <StateScreen compact icon={CheckCircle} tone="success" title="Paiement confirmé" description="Nous avons bien reçu votre paiement." className="pt-2" />
        <dl className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>
          ))}
        </dl>
        <Button size="lg" className="mt-6 w-full" onClick={onContinue}>{continueLabel} <ArrowRight /></Button>
      </div>
    );
  }

  if (state === "echec") {
    return (
      <div>
        <StateScreen compact icon={AlertCircle} tone="danger" title="Le paiement n'a pas abouti" description="Aucun montant n'a été débité. Voici les causes les plus fréquentes :" className="pt-2" />
        <ul className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          {["Solde insuffisant sur votre compte Mobile Money", "Code PIN incorrect ou saisi trop tard", "Paiement refusé par l'opérateur"].map((t) => <li key={t} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-destructive" />{t}</li>)}
        </ul>
        <Button size="lg" className="mt-5 w-full" onClick={() => (onPay ? onStateChange("mobile") : onStateChange("attente"))}><RefreshCw /> Réessayer</Button>
        <Button size="lg" variant="outline" className="mt-2 w-full" onClick={() => onStateChange("choix")}>Changer de moyen de paiement</Button>
      </div>
    );
  }

  return (
    <div>
      <StateScreen compact icon={Clock} tone="warning" title="La demande a expiré" description="Vous n'avez pas validé le paiement dans le délai imparti. Aucun montant n'a été débité." className="pt-2" />
      <Button size="lg" className="mt-2 w-full" onClick={() => (onPay ? onStateChange("mobile") : onStateChange("attente"))}><RefreshCw /> Relancer le paiement</Button>
      <Button size="lg" variant="ghost" className="mt-2 w-full" onClick={() => onStateChange("choix")}>Changer de moyen de paiement</Button>
    </div>
  );
}
