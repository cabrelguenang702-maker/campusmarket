import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, IconInput } from "@/components/cm/forms";
import { Buildings, MapPin, Tag, Users } from "@/components/icons";
import { countries } from "@/lib/mock-data";
import { flagByCountry } from "@/lib/university-directory";
import type { University } from "@/lib/mock-data";

export type UniversityDraft = { name: string; short: string; city: string; country: string; students: string };
const empty: UniversityDraft = { name: "", short: "", city: "", country: countries[0]?.code ?? "CM", students: "" };

export function UniversityFormDialog({ open, onOpenChange, initial, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: University | null; onSave: (draft: UniversityDraft) => void }) {
  const [draft, setDraft] = useState<UniversityDraft>(empty);
  useEffect(() => {
    if (open) setDraft(initial ? { name: initial.name, short: initial.short, city: initial.city, country: initial.country, students: initial.students } : empty);
  }, [open, initial]);

  const set = <K extends keyof UniversityDraft>(k: K, v: UniversityDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const valid = draft.name.trim().length > 2 && draft.short.trim().length > 0 && draft.city.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display">{initial ? "Modifier l'université" : "Ajouter une université"}</DialogTitle><DialogDescription>Elle apparaîtra immédiatement dans l'annuaire public.</DialogDescription></DialogHeader>
        <Field label="Nom complet" htmlFor="u-name"><IconInput id="u-name" icon={Buildings} placeholder="Ex. Université de Yaoundé I" value={draft.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sigle" htmlFor="u-short"><IconInput id="u-short" icon={Tag} placeholder="Ex. UY1" value={draft.short} onChange={(e) => set("short", e.target.value)} /></Field>
          <Field label="Étudiants (approx.)" htmlFor="u-students"><IconInput id="u-students" icon={Users} placeholder="Ex. 60 000" value={draft.students} onChange={(e) => set("students", e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ville" htmlFor="u-city"><IconInput id="u-city" icon={MapPin} placeholder="Ex. Yaoundé" value={draft.city} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="Pays" htmlFor="u-country"><Select value={draft.country} onValueChange={(v) => set("country", v)}><SelectTrigger id="u-country" className="h-11 bg-card"><SelectValue /></SelectTrigger><SelectContent>{countries.map((c) => <SelectItem key={c.code} value={c.code}>{flagByCountry[c.code]} {c.name}</SelectItem>)}</SelectContent></Select></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button><Button disabled={!valid} onClick={() => { onSave(draft); onOpenChange(false); }}>{initial ? "Enregistrer" : "Ajouter"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
