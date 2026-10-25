import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/cm/forms";
import { friendlyError } from "@/lib/api/errors";
import { formatFcfa } from "@/lib/domain";
import { DURATIONS, MODE_LABEL, durationLabel, useTutoringActions, type SessionMode, type Tutor } from "@/lib/api/tutoring";

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function RequestDialog({ tutor, open, onOpenChange }: { tutor: Tutor; open: boolean; onOpenChange: (o: boolean) => void }) {
  const acts = useTutoringActions();
  const navigate = useNavigate();
  const [subject, setSubject] = useState("");
  const [mode, setMode] = useState<SessionMode>("online");
  const [duration, setDuration] = useState("60");
  const [when, setWhen] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSubject(tutor.subjects[0] ?? ""); setMode(tutor.mode === "in_person" ? "in_person" : "online"); setDuration("60"); setWhen(""); setMessage(""); setError(null);
  }, [open, tutor]);

  const estimate = tutor.hourlyPrice > 0 ? Math.max(Math.round((tutor.hourlyPrice * Number(duration)) / 60), 500) : 0;

  const submit = async () => {
    if (!subject) return setError("Choisissez une matière.");
    let proposedAt: string | null = null;
    if (when) {
      const d = new Date(when);
      if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return setError("Le créneau souhaité doit être dans le futur.");
      proposedAt = d.toISOString();
    }
    if (message.length > 500) return setError("Le message est limité à 500 caractères.");
    setError(null);
    try {
      await acts.request.mutateAsync({ tutorId: tutor.userId, subject, message, mode, proposedAt, durationMinutes: Number(duration) });
      toast.success("Demande envoyée. Le tuteur vous répond sous peu.");
      onOpenChange(false);
      void navigate({ to: "/tutorat", search: { onglet: "demandes" } });
    } catch (e) { setError(friendlyError(e, "Demande impossible. Réessayez dans un instant.")); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Demander une séance à {tutor.name}</DialogTitle>
          <DialogDescription>{tutor.hourlyPrice > 0 ? "Vous ne payez qu'après l'acceptation de votre demande, avant la séance." : "Les séances de ce tuteur sont gratuites."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Matière" htmlFor="rq-subject">
            <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger id="rq-subject" className="bg-background"><SelectValue placeholder="Choisir" /></SelectTrigger>
              <SelectContent>{tutor.subjects.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mode" htmlFor="rq-mode">
              <Select value={mode} onValueChange={(v) => setMode(v as SessionMode)} disabled={tutor.mode !== "both"}>
                <SelectTrigger id="rq-mode" className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="online">{MODE_LABEL.online}</SelectItem><SelectItem value="in_person">{MODE_LABEL.in_person}</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="Durée" htmlFor="rq-duration">
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id="rq-duration" className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>{DURATIONS.map((d) => <SelectItem key={d} value={String(d)}>{durationLabel(d)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Créneau souhaité (facultatif)" htmlFor="rq-when" hint="Le tuteur fixe la date définitive en acceptant.">
            <Input id="rq-when" type="datetime-local" min={toLocalInput(new Date())} value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="Message (facultatif)" htmlFor="rq-message"><Textarea id="rq-message" rows={3} maxLength={500} placeholder="Ce sur quoi vous voulez travailler" value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
          {estimate > 0 && <p className="rounded-lg bg-secondary p-3 text-sm">Prix de la séance : <strong>{formatFcfa(estimate)}</strong> <span className="text-muted-foreground">({durationLabel(Number(duration))} à {formatFcfa(tutor.hourlyPrice)} / h)</span></p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={() => void submit()} disabled={acts.request.isPending}>{acts.request.isPending ? "Envoi…" : "Envoyer la demande"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
