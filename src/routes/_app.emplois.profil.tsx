import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, IconInput } from "@/components/cm/forms";
import { InlineAlert } from "@/components/cm/feedback";
import { ServerErrorScreen } from "@/components/cm/screens";
import { JobsTabs } from "@/components/jobs/JobBits";
import { PageHeader } from "@/components/layout/PageHeader";
import { Plus, Trash } from "@/components/icons";
import { useAuth } from "@/lib/auth";
import { friendlyError } from "@/lib/api/errors";
import { emptyProfile, useProProfile, useSaveProProfile, type ProItem, type ProProfile } from "@/lib/api/jobs";

export const Route = createFileRoute("/_app/emplois/profil")({
  head: () => ({ meta: [{ title: "Profil professionnel — Campus Jobs" }] }),
  component: ProProfilePage,
});

function ItemsEditor({ label, items, onChange, placeLabel }: { label: string; items: ProItem[]; onChange: (v: ProItem[]) => void; placeLabel: string }) {
  const patch = (i: number, p: Partial<ProItem>) => onChange(items.map((it, k) => (k === i ? { ...it, ...p } : it)));
  return (
    <fieldset className="space-y-2 rounded-xl border p-3">
      <legend className="px-1 text-sm font-semibold">{label}</legend>
      {items.map((it, i) => (
        <div key={i} className="grid gap-2 rounded-lg bg-secondary/50 p-2 sm:grid-cols-2">
          <IconInput aria-label="Intitulé" placeholder="Intitulé" value={it.title} maxLength={120} onChange={(e) => patch(i, { title: e.target.value })} />
          <IconInput aria-label={placeLabel} placeholder={placeLabel} value={it.place ?? ""} maxLength={120} onChange={(e) => patch(i, { place: e.target.value })} />
          <IconInput aria-label="Période" placeholder="Période (ex. 2023–2024)" value={it.period ?? ""} maxLength={60} onChange={(e) => patch(i, { period: e.target.value })} />
          <div className="flex gap-2">
            <IconInput aria-label="Description" placeholder="Description courte" value={it.description ?? ""} maxLength={300} onChange={(e) => patch(i, { description: e.target.value })} />
            <Button type="button" variant="ghost" size="icon" aria-label="Supprimer" onClick={() => onChange(items.filter((_, k) => k !== i))}><Trash /></Button>
          </div>
        </div>
      ))}
      {items.length < 10 && <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, { title: "" }])}><Plus /> Ajouter</Button>}
    </fieldset>
  );
}

function ProProfilePage() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const query = useProProfile(uid);
  const save = useSaveProProfile(uid);
  const [p, setP] = useState<ProProfile>(emptyProfile);
  const [skills, setSkills] = useState("");
  useEffect(() => { if (query.data) { setP(query.data); setSkills(query.data.skills.join(", ")); } }, [query.data]);

  if (query.isError) return <ServerErrorScreen onRetry={() => void query.refetch()} />;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <PageHeader kicker="Campus Jobs" title="Profil professionnel" description="Privé par défaut : il n'est transmis à un recruteur que lorsque vous postulez en l'incluant." />
      <JobsTabs active="profil" />
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate({ ...p, skills: skills.split(",").map((s) => s.trim()).filter(Boolean) }, { onSuccess: () => toast.success("Profil enregistré") }); }}>
        <Field label="Titre" htmlFor="headline" hint="Ex. Étudiant en informatique, recherche un stage de 3 mois"><IconInput id="headline" maxLength={120} value={p.headline} onChange={(e) => setP({ ...p, headline: e.target.value })} /></Field>
        <Field label="Présentation" htmlFor="summary"><Textarea id="summary" rows={4} maxLength={2000} value={p.summary} onChange={(e) => setP({ ...p, summary: e.target.value })} /></Field>
        <Field label="Compétences" htmlFor="skills" hint="Séparées par des virgules (20 max)"><IconInput id="skills" value={skills} onChange={(e) => setSkills(e.target.value)} /></Field>
        <ItemsEditor label="Formation" items={p.education} placeLabel="Établissement" onChange={(education) => setP({ ...p, education })} />
        <ItemsEditor label="Expériences" items={p.experiences} placeLabel="Organisation" onChange={(experiences) => setP({ ...p, experiences })} />
        <ItemsEditor label="Projets" items={p.projects} placeLabel="Contexte" onChange={(projects) => setP({ ...p, projects })} />
        <Field label="Portfolio (lien)" htmlFor="portfolio"><IconInput id="portfolio" type="url" placeholder="https://" value={p.portfolioUrl} onChange={(e) => setP({ ...p, portfolioUrl: e.target.value })} /></Field>
        {save.isError && <InlineAlert tone="danger">{friendlyError(save.error, "Impossible d'enregistrer le profil. Vérifiez le lien du portfolio.")}</InlineAlert>}
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Enregistrement…" : "Enregistrer"}</Button>
      </form>
    </div>
  );
}
