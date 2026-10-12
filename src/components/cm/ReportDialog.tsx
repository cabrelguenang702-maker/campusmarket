import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/cm/forms";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { reportReasons, submitReport, type ReportTarget } from "@/lib/api/engagement";
import { friendlyError } from "@/lib/api/errors";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; targetType: ReportTarget; targetId: string; subject: string };

/** Signalement d'un contenu ou d'un membre : enregistré dans la table reports, traité par la modération. */
export function ReportDialog({ open, onOpenChange, targetType, targetId, subject }: Props) {
  const { session } = useAuth();
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");

  const send = useMutation({
    mutationFn: () => {
      const reporterId = session?.user.id;
      if (!reporterId) throw new Error("not-authenticated");
      const label = reportReasons.find((r) => r.id === reason)?.label ?? reason;
      return submitReport({ reporterId, targetType, targetId, reason: label, details });
    },
    onSuccess: () => {
      toast.success("Signalement envoyé", { description: "Notre équipe de modération va l'examiner." });
      setReason("");
      setDetails("");
      onOpenChange(false);
    },
    onError: (error) => toast.error(friendlyError(error, "Le signalement n'a pas pu être envoyé. Réessayez.")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Signaler</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">Motif du signalement</legend>
          {reportReasons.map((r) => (
            <label key={r.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition", reason === r.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
              <input type="radio" name="report-reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} className="accent-[hsl(var(--primary))]" />
              {r.label}
            </label>
          ))}
        </fieldset>
        <Field label="Détails (facultatif)" htmlFor="report-details">
          <Textarea id="report-details" className="min-h-20" maxLength={1000} placeholder="Précisez ce qui vous pose problème." value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button disabled={!reason || send.isPending} onClick={() => send.mutate()}>{send.isPending ? "Envoi…" : "Envoyer le signalement"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
