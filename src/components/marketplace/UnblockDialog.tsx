import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PaymentFlow } from "@/components/cm/payment";
import { usePaymentProcess, type PaymentMethod } from "@/lib/api/payments";
import { CAMEROON, formatFcfa } from "@/lib/domain";
import { formatDeadline } from "@/lib/groupbuy-model";

/** Déblocage anticipé des achats groupés : 500 F par Mobile Money, même circuit que les autres paiements. Le déblocage n'est
 *  effectif que quand la base a enregistré le paiement ; cet écran observe sans jamais se l'attribuer. */
export const UNBLOCK_FEE = 500;

export function UnblockDialog({ open, onOpenChange, userId, blockedUntil }: { open: boolean; onOpenChange: (o: boolean) => void; userId: string | undefined; blockedUntil: string | null | undefined }) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<PaymentMethod>("mtn");
  const [phone, setPhone] = useState("");
  const payment = usePaymentProcess({
    kind: "unblock", targetId: userId,
    onConfirmed: () => { void qc.invalidateQueries({ queryKey: ["groupbuys"] }); void qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });
  useEffect(() => { if (open) payment.reset(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Lever le blocage</DialogTitle>
          <DialogDescription>
            Vous ne pouvez pas rejoindre d'achat groupé{blockedUntil ? ` jusqu'au ${formatDeadline(blockedUntil)}` : ""}. Pour {formatFcfa(UNBLOCK_FEE)}, le blocage est levé tout de suite. Vos achats classiques ne sont pas concernés.
          </DialogDescription>
        </DialogHeader>
        <PaymentFlow amount={UNBLOCK_FEE} state={payment.state} onStateChange={payment.setState} method={method} onMethodChange={setMethod} country={CAMEROON} phone={phone} onPhoneChange={setPhone}
          continueLabel="Terminer" onContinue={() => onOpenChange(false)} receipt={[["Déblocage", "Achats groupés"]]} reference="CM-DEBLOCAGE"
          onPay={() => void payment.pay(phone, method)} payBusy={payment.busy} payError={payment.error} onCheck={() => void payment.check()} onCancel={payment.reset} />
      </DialogContent>
    </Dialog>
  );
}
