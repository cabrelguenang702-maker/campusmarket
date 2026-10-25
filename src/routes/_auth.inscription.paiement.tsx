import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Check, CreditCard } from "@/components/icons";
import { AuthPage, IconBadge } from "@/components/auth/AuthPage";
import { InlineAlert, Spinner } from "@/components/cm/feedback";
import { PaymentFlow } from "@/components/cm/payment";
import { RequireSession, useAuth } from "@/lib/auth";
import { CAMEROON, formatFcfa } from "@/lib/domain";
import { usePaymentProcess, type PaymentMethod } from "@/lib/api/payments";
import { useMyRegistration } from "@/lib/api/registration";

export const Route = createFileRoute("/_auth/inscription/paiement")({
  head: () => ({ meta: [{ title: "Paiement de l'inscription — CampusMarket" }] }),
  component: () => (
    <RequireSession>
      <RegistrationPaymentPage />
    </RequireSession>
  ),
});

/** Paiement des frais d'inscription. Écran affiché seulement quand la base a marqué ce compte « en attente de paiement » :
 *  le tarif vient de my_registration (déduit du pays du téléphone vérifié), jamais du code. */
function RegistrationPaymentPage() {
  const { session, account, refreshAccount, signOut } = useAuth();
  const userId = session?.user.id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const reg = useMyRegistration(userId);
  const [method, setMethod] = useState<PaymentMethod>("mtn");
  const [phone, setPhone] = useState((account?.private?.phone ?? "").replace(/^\+237/, ""));
  const payment = usePaymentProcess({
    kind: "registration", targetId: userId,
    onConfirmed: () => { void qc.invalidateQueries({ queryKey: ["registration"] }); void refreshAccount(); void qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });

  // Rien à payer (inscription gratuite ou déjà réglée) : on passe à la suite, sauf si le paiement vient d'être confirmé ici.
  const nothingToPay = reg.data !== undefined && reg.data.status !== "pending_payment" && payment.state === "choix";
  useEffect(() => { if (nothingToPay) void navigate({ to: "/inscription/compte-cree", replace: true }); }, [nothingToPay, navigate]);

  if (reg.isPending || nothingToPay) {
    return <AuthPage title="Inscription" icon={<IconBadge icon={CreditCard} />}><div className="flex justify-center py-10" aria-busy><Spinner className="size-6" /></div></AuthPage>;
  }
  if (reg.isError) {
    return (
      <AuthPage title="Inscription" icon={<IconBadge icon={CreditCard} />}>
        <InlineAlert tone="warning">Impossible de lire l'état de votre inscription pour le moment.</InlineAlert>
        <Button size="lg" className="mt-4 w-full" onClick={() => void reg.refetch()}>Réessayer</Button>
      </AuthPage>
    );
  }

  const fee = reg.data.fee;

  // Tarif pas encore connu : la base le déduit de l'indicatif du téléphone, qui doit donc être vérifié d'abord.
  if (reg.data.status === "pending_payment" && fee === null) {
    return (
      <AuthPage back="/inscription/telephone" title="Vérifiez d'abord votre téléphone" description="Les frais d'inscription dépendent de votre pays, que nous déduisons de votre numéro de téléphone vérifié." icon={<IconBadge icon={CreditCard} />}>
        <InlineAlert tone="info">Votre compte sera activé dès que le numéro sera vérifié et, si votre pays le demande, les frais d'inscription réglés.</InlineAlert>
        <Button size="lg" className="mt-4 w-full" onClick={() => void navigate({ to: "/inscription/telephone" })}>Vérifier mon numéro</Button>
        <Button size="lg" variant="ghost" className="mt-2 w-full" onClick={() => void reg.refetch()}>J'ai déjà vérifié mon numéro</Button>
        <Button size="lg" variant="ghost" className="mt-1 w-full" onClick={() => void signOut()}>Me déconnecter</Button>
      </AuthPage>
    );
  }

  const amount = fee ?? reg.data.fee ?? 0;
  return (
    <AuthPage title="Finalisez votre inscription" description="Un paiement unique active votre compte étudiant CampusMarket." icon={<IconBadge icon={CreditCard} />}>
      {payment.state === "choix" && (
        <div className="mb-6 rounded-xl border border-primary/25 bg-primary/5 p-4">
          <div className="flex items-end justify-between">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Frais d'inscription</p><p className="mt-1 font-display text-3xl font-bold text-primary">{formatFcfa(amount)}</p></div>
            <span className="rounded-full bg-primary/12 px-2.5 py-1 text-[11px] font-bold text-primary">Paiement unique</span>
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            {["Accès à la marketplace, aux formations et aux communautés", "Profil étudiant avec badge de vérification", "Messagerie et paiements sécurisés"].map((t) => (
              <li key={t} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" />{t}</li>
            ))}
          </ul>
        </div>
      )}
      <PaymentFlow amount={amount} state={payment.state} onStateChange={payment.setState} method={method} onMethodChange={setMethod} country={CAMEROON} phone={phone} onPhoneChange={setPhone}
        continueLabel="Finaliser mon compte" onContinue={() => void navigate({ to: "/inscription/compte-cree" })}
        receipt={[["Inscription", "Frais uniques"]]} reference={`CM-INSCRIPTION-${(userId ?? "").slice(0, 6).toUpperCase()}`}
        onPay={() => void payment.pay(phone, method)} payBusy={payment.busy} payError={payment.error} onCheck={() => void payment.check()} onCancel={payment.reset} />
      {payment.state === "choix" && <p className="mt-3 text-center text-[11px] text-muted-foreground">Paiement sécurisé · Aucun frais caché</p>}
    </AuthPage>
  );
}
