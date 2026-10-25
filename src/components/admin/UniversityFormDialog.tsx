import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, IconInput } from "@/components/cm/forms";
import { Buildings, MapPin, Tag, Users } from "@/components/icons";
import type { AdminCountry, AdminUniversity, UniversityDraft } from "@/lib/api/admin-geo";

const empty = (country: string): UniversityDraft => ({ name: "", shortName: "", city: "", countryCode: country, students: "" });

/** Création et modification d'une université de l'annuaire. Le pays vient de la base ; le sigle doit être unique dans son pays
 *  (la base refuse un doublon). Le nombre d'étudiants est une approximation facultative. */
export function UniversityFormDialog({ open, onOpenChange, initial, countries, busy, onSave }: {
  open: boolean; onOpenChange: (o: boolean) => void; initial: AdminUniversity | null; countries: AdminCountry[]; busy: boolean; onSave: (draft: UniversityDraft) => void;
}) {
  const [draft, setDraft] = useState<UniversityDraft>(empty(countries[0]?.code ?? "CM"));
  useEffect(() => {
    if (open) setDraft(initial ? { name: initial.name, shortName: initial.shortName, city: initial.city, countryCode: initial.countryCode, students: initial.students?.toString() ?? "" } : empty(countries[0]?.code ?? "CM"));
  }, [open, initial, countries]);

  const set = <K extends keyof UniversityDraft>(k: K, v: UniversityDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const valid = draft.name.trim().length >= 3 && draft.shortName.trim().length >= 1 && draft.city.trim().length >= 2 && !!draft.countryCode;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display">{initial ? "Modifier l'université" : "Ajouter une université"}</DialogTitle><DialogDescription>Elle apparaît dans l'annuaire public et au moment de l'inscription des étudiants.</DialogDescription></DialogHeader>
        <Field label="Nom complet" htmlFor="u-name"><IconInput id="u-name" icon={Buildings} maxLength={150} placeholder="Ex. Université de Yaoundé I" value={draft.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sigle" htmlFor="u-short"><IconInput id="u-short" icon={Tag} maxLength={20} placeholder="Ex. UY1" value={draft.shortName} onChange={(e) => set("shortName", e.target.value)} /></Field>
          <Field label="Étudiants (approx.)" htmlFor="u-students"><IconInput id="u-students" icon={Users} inputMode="numeric" placeholder="Ex. 60000" value={draft.students} onChange={(e) => set("students", e.target.value.replace(/\D/g, ""))} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ville" htmlFor="u-city"><IconInput id="u-city" icon={MapPin} maxLength={100} placeholder="Ex. Yaoundé" value={draft.city} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="Pays" htmlFor="u-country"><Select value={draft.countryCode} onValueChange={(v) => set("countryCode", v)}><SelectTrigger id="u-country" className="h-11 bg-card"><SelectValue /></SelectTrigger><SelectContent>{countries.map((c) => <SelectItem key={c.code} value={c.code}>{c.flag} {c.name}</SelectItem>)}</SelectContent></Select></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button><Button disabled={!valid || busy} onClick={() => onSave(draft)}>{busy ? "Enregistrement…" : initial ? "Enregistrer" : "Ajouter"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
