import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/cm/forms";
import { studyError, useStudyGroupActions } from "@/lib/api/study-groups";
import { useAuth } from "@/lib/auth";

const DURATIONS = [30, 45, 60, 90, 120, 180, 240];

/** Valeur d'un champ datetime-local (heure locale) pour une date donnée. */
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function SessionDialog({ open, onOpenChange, groupId }: { open: boolean; onOpenChange: (o: boolean) => void; groupId: string }) {
  const { session } = useAuth();
  const acts = useStudyGroupActions(session?.user.id);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(""); setWhen(toLocalInput(new Date(Date.now() + 24 * 3_600_000))); setDuration("60"); setLocation(""); setNotes(""); setError(null);
  }, [open]);

  const submit = async () => {
    if (title.trim().length < 3 || title.trim().length > 100) return setError("Le titre de la séance fait de 3 à 100 caractères.");
    const date = new Date(when);
    if (!when || Number.isNaN(date.getTime())) return setError("Choisissez une date et une heure.");
    if (date.getTime() < Date.now()) return setError("La séance doit être programmée dans le futur.");
    if (location.length > 200) return setError("Le lieu ou lien est limité à 200 caractères.");
    setError(null);
    try {
      await acts.createSession.mutateAsync({ groupId, title, startsAt: date.toISOString(), durationMinutes: Number(duration), location, notes });
      toast.success("Séance programmée. Les membres sont prévenus.");
      onOpenChange(false);
    } catch (e) { setError(studyError(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Programmer une séance</DialogTitle>
          <DialogDescription>Tous les membres du groupe reçoivent une notification.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Titre" htmlFor="ss-title"><Input id="ss-title" maxLength={100} placeholder="Ex. Exercices sur les limites" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date et heure" htmlFor="ss-when"><Input id="ss-when" type="datetime-local" min={toLocalInput(new Date())} value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
            <Field label="Durée" htmlFor="ss-duration">
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id="ss-duration" className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>{DURATIONS.map((d) => <SelectItem key={d} value={String(d)}>{d >= 60 ? `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60}` : ""}` : `${d} min`}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Lieu ou lien de visio (facultatif)" htmlFor="ss-location"><Input id="ss-location" maxLength={200} placeholder="Ex. Bibliothèque, salle 3 — ou lien Meet" value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
          <Field label="Notes (facultatif)" htmlFor="ss-notes"><Textarea id="ss-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={() => void submit()} disabled={acts.createSession.isPending}>{acts.createSession.isPending ? "Enregistrement…" : "Programmer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
