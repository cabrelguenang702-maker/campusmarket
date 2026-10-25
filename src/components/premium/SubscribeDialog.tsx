import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PaymentFlow } from "@/components/cm/payment";
import { usePaymentProcess, type PaymentMethod } from "@/lib/api/payments";
import { CAMEROON } from "@/lib/domain";
import { durationLabel, type SellerPlan } from "@/lib/api/premium";

/** Paiement d'une formule Boutique Premium : même circuit Mobile Money que les autres achats ; le montant affiché est celui de la base,
 *  l'abonnement ne devient actif que quand la base a enregistré le paiement. */
export function SubscribeDialog({ plan, onClose }: { plan: SellerPlan | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<PaymentMethod>("mtn");
  const [phone, setPhone] = useState("");
  const payment = usePaymentProcess({
    kind: "subscription", targetId: plan?.id,
    onConfirmed: () => { void qc.invalidateQueries({ queryKey: ["premium"] }); void qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });
  useEffect(() => { if (plan) payment.reset(); }, [plan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={plan !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Boutique Premium</DialogTitle>
          <DialogDescription>{plan ? `Formule « ${plan.label} » : ${durationLabel(plan.days)} d'abonnement. Si vous êtes déjà abonné, la nouvelle période commence à la fin de l'actuelle.` : ""}</DialogDescription>
        </DialogHeader>
        {plan && (
          <PaymentFlow amount={plan.price} state={payment.state} onStateChange={payment.setState} method={method} onMethodChange={setMethod} country={CAMEROON} phone={phone} onPhoneChange={setPhone}
            continueLabel="Terminer" onContinue={onClose} receipt={[["Formule", plan.label], ["Durée", durationLabel(plan.days)]]} reference={`CM-PREMIUM-${plan.id.slice(0, 6).toUpperCase()}`}
            onPay={() => void payment.pay(phone, method)} payBusy={payment.busy} payError={payment.error} onCheck={() => void payment.check()} onCancel={payment.reset} />
        )}
      </DialogContent>
    </Dialog>
  );
}
