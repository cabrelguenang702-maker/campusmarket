import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/cm/forms";
import { studyError, useEnrolledCourses, useStudyGroupActions, type StudyGroup } from "@/lib/api/study-groups";
import { useAuth } from "@/lib/auth";

const NO_COURSE = "none";

/** Création (group = null) ou modification d'un groupe. La formation liée ne se choisit qu'à la création. */
export function GroupFormDialog({ open, onOpenChange, group, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; group: StudyGroup | null; onCreated?: (id: string) => void }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const acts = useStudyGroupActions(userId);
  const courses = useEnrolledCourses(open && !group ? userId : undefined);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [max, setMax] = useState("12");
  const [courseId, setCourseId] = useState(NO_COURSE);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(group?.title ?? ""); setSubject(group?.subject ?? ""); setDescription(group?.description ?? "");
    setMax(String(group?.maxMembers ?? 12)); setCourseId(NO_COURSE); setError(null);
  }, [open, group]);

  const pending = acts.create.isPending || acts.update.isPending;
  const submit = async () => {
    const m = Number(max);
    if (title.trim().length < 3 || title.trim().length > 80) return setError("Le nom du groupe fait de 3 à 80 caractères.");
    if (subject.trim().length < 2 || subject.trim().length > 60) return setError("La matière fait de 2 à 60 caractères.");
    if (description.length > 1000) return setError("La description est limitée à 1 000 caractères.");
    if (!Number.isInteger(m) || m < 2 || m > 50) return setError("Le nombre de places va de 2 à 50.");
    setError(null);
    try {
      if (group) {
        await acts.update.mutateAsync({ id: group.id, title, subject, description, maxMembers: m });
        toast.success("Groupe mis à jour.");
        onOpenChange(false);
      } else {
        const id = await acts.create.mutateAsync({ title, subject, description, maxMembers: m, courseId: courseId === NO_COURSE ? null : courseId });
        toast.success("Groupe créé.");
        onOpenChange(false);
        onCreated?.(id);
      }
    } catch (e) { setError(studyError(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">{group ? "Modifier le groupe" : "Créer un groupe de révision"}</DialogTitle>
          <DialogDescription>Réunissez des étudiants pour réviser une matière ensemble, avec des séances planifiées.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Nom du groupe" htmlFor="sg-title"><Input id="sg-title" maxLength={80} placeholder="Ex. Révisions d'analyse L2" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Matière" htmlFor="sg-subject"><Input id="sg-subject" maxLength={60} placeholder="Ex. Mathématiques" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label="Description (facultatif)" htmlFor="sg-desc"><Textarea id="sg-desc" rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="Nombre de places" htmlFor="sg-max" hint={group ? `Au moins ${group.memberCount} (membres actuels).` : "De 2 à 50 personnes, vous comprise ou compris."}>
            <Input id="sg-max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />
          </Field>
          {!group && (courses.data?.length ?? 0) > 0 && (
            <Field label="Formation liée (facultatif)" htmlFor="sg-course" hint="Parmi vos formations en cours.">
              <Select value={courseId} onValueChange={setCourseId}>
                <SelectTrigger id="sg-course" className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COURSE}>Aucune</SelectItem>
                  {courses.data!.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={() => void submit()} disabled={pending}>{pending ? "Enregistrement…" : group ? "Enregistrer" : "Créer le groupe"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
