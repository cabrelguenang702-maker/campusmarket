import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/cm/forms";
import { PaymentFlow } from "@/components/cm/payment";
import { friendlyError } from "@/lib/api/errors";
import { usePaymentProcess, type PaymentMethod } from "@/lib/api/payments";
import { CAMEROON, formatFcfa } from "@/lib/domain";
import { useTutoringActions, durationLabel, type TutoringRequest } from "@/lib/api/tutoring";
import { StarInput } from "./Stars";

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Le tuteur accepte (date + lieu) ou refuse (note). */
export function RespondDialog({ request, accept, onClose }: { request: TutoringRequest | null; accept: boolean; onClose: () => void }) {
  const acts = useTutoringActions();
  const [when, setWhen] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    const base = request.proposedAt ? new Date(request.proposedAt) : new Date(Date.now() + 48 * 3_600_000);
    setWhen(toLocalInput(base)); setLocation(""); setNote(""); setError(null);
  }, [request]);

  const submit = async () => {
    if (!request) return;
    let scheduledAt: string | null = null;
    if (accept) {
      const d = new Date(when);
      if (!when || Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return setError("Choisissez une date et une heure dans le futur.");
      if (request.price > 0 && d.getTime() < Date.now() + 2 * 3_600_000) return setError("Une séance payante doit commencer dans au moins 2 heures, pour laisser le temps de payer.");
      if (location.trim().length < 2) return setError("Indiquez le lieu ou le lien de la séance.");
      scheduledAt = d.toISOString();
    }
    setError(null);
    try {
      await acts.respond.mutateAsync({ id: request.id, accept, scheduledAt, location, note });
      toast.success(accept ? "Séance acceptée. L'élève est prévenu." : "Demande refusée.");
      onClose();
    } catch (e) { setError(friendlyError(e, "Action impossible. Réessayez dans un instant.")); }
  };

  return (
    <Dialog open={request !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">{accept ? "Accepter la séance" : "Refuser la demande"}</DialogTitle>
          <DialogDescription>{request ? `${request.studentName} · ${request.subject} · ${durationLabel(request.durationMinutes)}${request.price > 0 ? ` · ${formatFcfa(request.price)}` : ""}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {request?.message && <p className="rounded-lg bg-secondary p-3 text-sm">« {request.message} »</p>}
          {accept && (
            <>
              <Field label="Date et heure" htmlFor="rs-when" hint={request?.price ? "L'élève dispose de 24 h (ou jusqu'à 1 h avant la séance) pour payer." : undefined}>
                <Input id="rs-when" type="datetime-local" min={toLocalInput(new Date())} value={when} onChange={(e) => setWhen(e.target.value)} />
              </Field>
              <Field label="Lieu ou lien de visio" htmlFor="rs-location"><Input id="rs-location" maxLength={200} placeholder="Ex. Bibliothèque, salle 2 — ou lien Meet" value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
            </>
          )}
          <Field label={accept ? "Message pour l'élève (facultatif)" : "Raison (facultatif)"} htmlFor="rs-note"><Textarea id="rs-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Retour</Button>
          <Button variant={accept ? "default" : "destructive"} onClick={() => void submit()} disabled={acts.respond.isPending}>{accept ? "Accepter" : "Refuser"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** L'élève note une séance terminée. */
export function ReviewDialog({ request, onClose }: { request: TutoringRequest | null; onClose: () => void }) {
  const acts = useTutoringActions();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (request) { setRating(0); setComment(""); setError(null); } }, [request]);

  const submit = async () => {
    if (!request) return;
    if (rating < 1) return setError("Choisissez une note de 1 à 5.");
    setError(null);
    try {
      await acts.review.mutateAsync({ id: request.id, rating, comment });
      toast.success("Merci pour votre avis.");
      onClose();
    } catch (e) { setError(friendlyError(e, "Action impossible. Réessayez dans un instant.")); }
  };

  return (
    <Dialog open={request !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-display">Noter la séance</DialogTitle><DialogDescription>{request ? `${request.tutorName} · ${request.subject}` : ""}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <StarInput value={rating} onChange={setRating} />
          <Field label="Commentaire (facultatif)" htmlFor="rv-comment"><Textarea id="rv-comment" rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Plus tard</Button><Button onClick={() => void submit()} disabled={acts.review.isPending}>Envoyer mon avis</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Paiement d'une séance acceptée : même circuit Mobile Money que les autres achats ; le montant vient de la base. */
export function TutoringPayDialog({ request, onClose }: { request: TutoringRequest | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<PaymentMethod>("mtn");
  const [phone, setPhone] = useState("");
  const payment = usePaymentProcess({
    kind: "tutoring", targetId: request?.id,
    onConfirmed: () => { void qc.invalidateQueries({ queryKey: ["tutoring"] }); void qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });
  useEffect(() => { if (request) payment.reset(); }, [request?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={request !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Payer la séance</DialogTitle>
          <DialogDescription>{request ? `${request.subject} avec ${request.tutorName}. Si la séance est annulée après paiement, vous êtes remboursé.` : ""}</DialogDescription>
        </DialogHeader>
        {request && (
          <PaymentFlow amount={request.price} state={payment.state} onStateChange={payment.setState} method={method} onMethodChange={setMethod} country={CAMEROON} phone={phone} onPhoneChange={setPhone}
            continueLabel="Terminer" onContinue={onClose} receipt={[["Séance", request.subject], ["Tuteur", request.tutorName]]} reference={`CM-TUTORAT-${request.id.slice(0, 6).toUpperCase()}`}
            onPay={() => void payment.pay(phone, method)} payBusy={payment.busy} payError={payment.error} onCheck={() => void payment.check()} onCancel={payment.reset} />
        )}
      </DialogContent>
    </Dialog>
  );
}
