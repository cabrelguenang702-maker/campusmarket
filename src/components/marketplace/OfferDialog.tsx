import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, IconInput } from "@/components/cm/forms";
import { Coin } from "@/components/icons";
import { formatFcfa, type Product } from "@/lib/domain";
import { useAuth } from "@/lib/auth";
import { createOffer } from "@/lib/api/engagement";
import { friendlyError } from "@/lib/api/errors";

export function OfferDialog({ product, open, onOpenChange }: { product: Product; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [amount, setAmount] = useState(String(Math.round(product.price * 0.95 / 1000) * 1000));
  const [message, setMessage] = useState("");
  const value = Number(amount.replace(/\D/g, ""));
  const tooLow = value > 0 && value < product.price * 0.6;
  const invalid = !value || value >= product.price;
  const { session } = useAuth();
  const qc = useQueryClient();
  const send = useMutation({
    mutationFn: () => {
      const buyerId = session?.user.id;
      if (!buyerId) throw new Error("not-authenticated");
      return createOffer({ buyerId, sellerId: product.sellerId, productId: product.id, amount: value, message });
    },
    onSuccess: () => {
      toast.success("Offre envoyée au vendeur", { description: `${formatFcfa(value)} · réponse sous 24 h` });
      void qc.invalidateQueries({ queryKey: ["my-offer", product.id] });
      setMessage("");
      onOpenChange(false);
    },
    onError: (error) => toast.error(friendlyError(error, "L'offre n'a pas pu être envoyée. Réessayez.")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Faire une offre</DialogTitle>
          <DialogDescription>Prix demandé : {formatFcfa(product.price)}. Le vendeur peut accepter, refuser ou vous faire une contre-proposition.</DialogDescription>
        </DialogHeader>
        <Field label="Votre offre (FCFA)" htmlFor="offer-amount" error={value >= product.price ? "Votre offre doit être inférieure au prix demandé." : tooLow ? "Cette offre est très éloignée du prix : elle risque d'être refusée." : undefined}>
          <IconInput id="offer-amount" icon={Coin} inputMode="numeric" value={value ? value.toLocaleString("fr-FR") : ""} onChange={(e) => setAmount(e.target.value)} invalid={value >= product.price} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {[5, 10, 15].map((pct) => <button key={pct} type="button" onClick={() => setAmount(String(Math.round(product.price * (1 - pct / 100) / 500) * 500))} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:border-primary/50">-{pct} % · {formatFcfa(Math.round(product.price * (1 - pct / 100) / 500) * 500)}</button>)}
        </div>
        <Field label="Message (facultatif)" htmlFor="offer-message"><Textarea id="offer-message" className="min-h-20" placeholder="Bonjour, je suis intéressé. Puis-je passer sur le campus demain ?" value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button disabled={invalid || send.isPending} onClick={() => send.mutate()}>{send.isPending ? "Envoi…" : "Envoyer l'offre"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
