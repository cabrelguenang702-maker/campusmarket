import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalendarDays, CheckCircle, MapPin, Users } from "@/components/icons";
import { LoadingButtonLabel, Spinner, StateScreen } from "@/components/cm/feedback";
import { PaymentFlow } from "@/components/cm/payment";
import { ETicket } from "./ETicket";
import { usePaymentProcess, type PaymentMethod } from "@/lib/api/payments";
import { friendlyError } from "@/lib/api/errors";
import { CAMEROON, formatFcfa } from "@/lib/domain";
import { remaining, type EventItem, type MyTicket } from "@/lib/events-model";

type Step = "recap" | "paiement" | "succes";

/**
 * Inscription : récapitulatif, puis inscription directe (gratuit) ou paiement Mobile Money. Pour un billet payant, il n'est
 * valide que lorsque la base a enregistré le paiement ; cet écran observe sans jamais s'attribuer le billet.
 */
export function TicketDialog({ event, open, onOpenChange, ticket, holder, onRegisterFree, freeBusy, onChanged }: {
  event: EventItem; open: boolean; onOpenChange: (o: boolean) => void; ticket: MyTicket | undefined; holder: string;
  onRegisterFree: () => Promise<void>; freeBusy: boolean; onChanged: () => void;
}) {
  const [step, setStep] = useState<Step>("recap");
  const [method, setMethod] = useState<PaymentMethod>("mtn");
  const [phone, setPhone] = useState("");
  const payment = usePaymentProcess({ kind: "event", targetId: event.id, onConfirmed: onChanged });
  const Icon = event.icon;
  const left = remaining(event);
  useEffect(() => { if (open) { setStep(ticket?.status === "pending_payment" ? "paiement" : "recap"); payment.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const registerFree = async () => {
    try { await onRegisterFree(); setStep("succes"); }
    catch (e) { toast.error("Inscription impossible", { description: friendlyError(e) }); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        {step === "succes" ? (
          <>
            <DialogTitle className="sr-only">Inscription confirmée</DialogTitle>
            <DialogDescription className="sr-only">Votre billet pour {event.name} est prêt.</DialogDescription>
            <StateScreen compact icon={CheckCircle} tone="success" title="Vous êtes inscrit·e !" description="Votre billet électronique est prêt, présentez-le à l'entrée." className="py-2" />
            {ticket?.code ? <ETicket event={event} code={ticket.code} holder={holder} status={ticket.status} /> : <div className="grid place-items-center py-6" aria-busy><Spinner className="size-5" /></div>}
            <Button className="mt-4 w-full" onClick={() => onOpenChange(false)}>Fermer</Button>
          </>
        ) : step === "paiement" ? (
          <>
            <DialogHeader><DialogTitle className="font-display">Paiement du billet</DialogTitle><DialogDescription>{event.name}</DialogDescription></DialogHeader>
            <PaymentFlow amount={event.price} state={payment.state} onStateChange={payment.setState} method={method} onMethodChange={setMethod} country={CAMEROON} phone={phone} onPhoneChange={setPhone}
              continueLabel="Voir mon billet" onContinue={() => setStep("succes")} receipt={[["Événement", event.name]]} reference={`CM-E-${event.id.slice(0, 8).toUpperCase()}`}
              onPay={() => void payment.pay(phone, method)} payBusy={payment.busy} payError={payment.error} onCheck={() => void payment.check()} onCancel={payment.reset} />
          </>
        ) : (
          <>
            <DialogHeader><DialogTitle className="font-display">{event.price === 0 ? "S'inscrire à l'événement" : "Réserver votre billet"}</DialogTitle><DialogDescription>Vérifiez les informations avant de confirmer.</DialogDescription></DialogHeader>
            <div className="flex gap-3 rounded-lg border border-border bg-card p-3.5">
              <span className={`grid size-14 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${event.tone}`}><Icon className="size-7 text-primary" /></span>
              <div className="min-w-0"><p className="truncate font-semibold">{event.name}</p><p className="text-xs text-muted-foreground">{event.organizer}</p></div>
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2"><CalendarDays className="size-4 text-primary" />{event.dateLabel}</li>
              <li className="flex items-center gap-2"><MapPin className="size-4 text-primary" />{event.place} · {event.campus}</li>
              <li className="flex items-center gap-2"><Users className="size-4 text-primary" />{left} place{left > 1 ? "s" : ""} restante{left > 1 ? "s" : ""}</li>
            </ul>
            <div className="flex items-center justify-between border-t border-border pt-4"><span className="text-sm text-muted-foreground">Total</span><span className="font-display text-xl font-bold text-primary">{event.price === 0 ? "Gratuit" : formatFcfa(event.price)}</span></div>
            <Button size="lg" className="w-full" disabled={freeBusy} onClick={() => (event.price === 0 ? void registerFree() : setStep("paiement"))}>
              <LoadingButtonLabel loading={freeBusy} loadingText="Inscription…">{event.price === 0 ? "Confirmer l'inscription" : `Payer ${formatFcfa(event.price)}`}</LoadingButtonLabel>
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
