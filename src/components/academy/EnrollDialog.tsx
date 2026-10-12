import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Certificate, CheckCircle, Clock, Layers } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { LoadingButtonLabel, StateScreen } from "@/components/cm/feedback";
import { PaymentFlow } from "@/components/cm/payment";
import { PriceTag } from "./CourseCard";
import { courseMinutes, formatDuration, type Course } from "@/lib/academy-model";
import { usePaymentProcess, type PaymentMethod } from "@/lib/api/payments";
import { friendlyError } from "@/lib/api/errors";
import { CAMEROON, formatFcfa } from "@/lib/domain";

type Step = "recap" | "paiement" | "succes";

/**
 * Inscription à une formation : récapitulatif, puis soit inscription directe (gratuite), soit paiement Mobile Money (CamPay).
 * Pour une formation payante, l'accès n'est ouvert que lorsque la base a enregistré le paiement : l'écran ne fait
 * qu'observer la tentative, il ne s'attribue jamais l'accès tout seul.
 */
export function EnrollDialog({ course, open, onOpenChange, onEnrollFree, freeBusy, onPaid }: {
  course: Course;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Inscription gratuite : doit lever une erreur en cas d'échec. */
  onEnrollFree: () => Promise<void>;
  freeBusy: boolean;
  /** Appelé quand le paiement est confirmé : l'appelant rafraîchit les inscriptions. */
  onPaid: () => void;
}) {
  const [step, setStep] = useState<Step>("recap");
  const [method, setMethod] = useState<PaymentMethod>("mtn");
  const [phone, setPhone] = useState("");
  const payment = usePaymentProcess({ kind: "course", targetId: course.id, onConfirmed: onPaid });
  const first = course.modules[0];
  useEffect(() => { if (open) { setStep("recap"); payment.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const enrollFree = async () => {
    try { await onEnrollFree(); setStep("succes"); }
    catch (e) { toast.error("Inscription impossible", { description: friendlyError(e) }); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {step === "succes" ? (
          <>
            <DialogTitle className="sr-only">Inscription réussie</DialogTitle>
            <DialogDescription className="sr-only">Vous êtes inscrit à la formation.</DialogDescription>
            <StateScreen compact icon={CheckCircle} tone="success" title="Inscription réussie !" description={`Vous avez maintenant accès à « ${course.title} ». Bonne formation !`} className="py-4"
              actions={first ? <Button asChild size="lg" className="w-full"><AppLink to={`/formations/${course.id}/modules/${first.id}`} onClick={() => onOpenChange(false)}>Commencer la formation</AppLink></Button> : <Button size="lg" className="w-full" onClick={() => onOpenChange(false)}>Fermer</Button>} />
          </>
        ) : step === "paiement" ? (
          <>
            <DialogHeader><DialogTitle className="font-display">Paiement de la formation</DialogTitle><DialogDescription>{course.title}</DialogDescription></DialogHeader>
            <PaymentFlow amount={course.price} state={payment.state} onStateChange={payment.setState} method={method} onMethodChange={setMethod} country={CAMEROON} phone={phone} onPhoneChange={setPhone}
              continueLabel="Accéder à la formation" onContinue={() => setStep("succes")} receipt={[["Formation", course.title]]} reference={`CM-F-${course.id.slice(0, 8).toUpperCase()}`}
              onPay={() => void payment.pay(phone, method)} payBusy={payment.busy} payError={payment.error} onCheck={() => void payment.check()} onCancel={payment.reset} />
          </>
        ) : (
          <>
            <DialogHeader><DialogTitle className="font-display">Inscription à la formation</DialogTitle><DialogDescription>Vérifiez les informations avant de vous inscrire.</DialogDescription></DialogHeader>
            <div className="flex gap-3 rounded-lg border border-border bg-card p-3.5">
              <span className={`grid size-14 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${course.tone}`}><course.icon className="size-7 text-primary" /></span>
              <div className="min-w-0"><p className="truncate font-semibold">{course.title}</p><p className="text-xs text-muted-foreground">{course.instructor.name}</p></div>
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2"><Layers className="size-4 text-primary" />{course.modules.length} modules</li>
              <li className="flex items-center gap-2"><Clock className="size-4 text-primary" />{formatDuration(courseMinutes(course))} de contenu</li>
              <li className="flex items-center gap-2"><Certificate className="size-4 text-primary" />Certificat de réussite inclus</li>
            </ul>
            <div className="flex items-center justify-between border-t border-border pt-4"><span className="text-sm text-muted-foreground">Total</span><PriceTag price={course.price} className="text-xl" /></div>
            <Button size="lg" className="w-full" disabled={freeBusy} onClick={() => (course.price === 0 ? void enrollFree() : setStep("paiement"))}>
              <LoadingButtonLabel loading={freeBusy} loadingText="Inscription…">{course.price === 0 ? "Confirmer l'inscription" : `Payer ${formatFcfa(course.price)}`}</LoadingButtonLabel>
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
