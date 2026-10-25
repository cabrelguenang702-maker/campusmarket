import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, IconInput } from "@/components/cm/forms";
import { InlineAlert } from "@/components/cm/feedback";
import { useCountries } from "@/lib/api/geo";
import { friendlyError } from "@/lib/api/errors";
import { KIND_LABEL, LEVEL_LABEL, MODE_LABEL, type JobKind, type JobLevel, type OfferDraft, type WorkMode } from "@/lib/api/jobs";

const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";

export function OfferForm({ initial, pending, error, onSubmit, onCancel }: { initial: OfferDraft; pending: boolean; error: unknown; onSubmit: (d: OfferDraft) => void; onCancel: () => void }) {
  const [d, setD] = useState<OfferDraft>(initial);
  const [skills, setSkills] = useState(initial.skills.join(", "));
  const [questions, setQuestions] = useState(initial.questions.join("\n"));
  const countries = useCountries();
  const set = <K extends keyof OfferDraft>(k: K, v: OfferDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  return (
    <form className="space-y-4 rounded-xl border p-4" onSubmit={(e) => { e.preventDefault(); onSubmit({ ...d, skills: skills.split(",").map((s) => s.trim()).filter(Boolean), questions: questions.split("\n").map((s) => s.trim()).filter(Boolean) }); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" htmlFor="kind"><select id="kind" className={selectClass} value={d.kind} onChange={(e) => set("kind", e.target.value as JobKind)}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Niveau" htmlFor="level"><select id="level" className={selectClass} value={d.level} onChange={(e) => set("level", e.target.value as JobLevel)}>{Object.entries(LEVEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      <Field label="Titre" htmlFor="title" hint="5 à 150 caractères"><IconInput id="title" maxLength={150} value={d.title} onChange={(e) => set("title", e.target.value)} required /></Field>
      <Field label="Description" htmlFor="desc" hint="30 caractères minimum"><Textarea id="desc" rows={6} maxLength={5000} value={d.description} onChange={(e) => set("description", e.target.value)} required /></Field>
      <Field label="Missions" htmlFor="resp"><Textarea id="resp" rows={3} maxLength={3000} value={d.responsibilities} onChange={(e) => set("responsibilities", e.target.value)} /></Field>
      <Field label="Compétences" htmlFor="skills" hint="Séparées par des virgules (15 max)"><IconInput id="skills" value={skills} onChange={(e) => setSkills(e.target.value)} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Mode" htmlFor="mode"><select id="mode" className={selectClass} value={d.workMode} onChange={(e) => set("workMode", e.target.value as WorkMode)}>{Object.entries(MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Pays" htmlFor="country"><select id="country" className={selectClass} value={d.countryCode} onChange={(e) => set("countryCode", e.target.value)}><option value="">—</option>{(countries.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
        <Field label="Ville" htmlFor="city"><IconInput id="city" maxLength={100} value={d.city} onChange={(e) => set("city", e.target.value)} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Domaine" htmlFor="domain"><IconInput id="domain" maxLength={80} value={d.domain} onChange={(e) => set("domain", e.target.value)} /></Field>
        <Field label="Rémunération" htmlFor="comp"><IconInput id="comp" maxLength={150} placeholder="Ex. 50 000 F / mois" value={d.compensation} onChange={(e) => set("compensation", e.target.value)} /></Field>
        <Field label="Date limite" htmlFor="deadline"><IconInput id="deadline" type="date" value={d.deadline} onChange={(e) => set("deadline", e.target.value)} /></Field>
      </div>
      <Field label="Questions aux candidats" htmlFor="qs" hint="Une par ligne, 5 maximum"><Textarea id="qs" rows={3} value={questions} onChange={(e) => setQuestions(e.target.value)} /></Field>
      {error != null && <InlineAlert tone="danger">{friendlyError(error, "Impossible d'enregistrer l'offre. Vérifiez les champs.")}</InlineAlert>}
      <div className="flex gap-2"><Button type="submit" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer le brouillon"}</Button><Button type="button" variant="outline" onClick={onCancel}>Annuler</Button></div>
    </form>
  );
}
