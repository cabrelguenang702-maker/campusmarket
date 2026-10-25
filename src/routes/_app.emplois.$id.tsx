import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/cm/forms";
import { InlineAlert, StateScreen } from "@/components/cm/feedback";
import { NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { JobMeta } from "@/components/jobs/JobBits";
import { PageHeader } from "@/components/layout/PageHeader";
import { BadgeCheck, Briefcase } from "@/components/icons";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/domain";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { useApply, useJobOffer } from "@/lib/api/jobs";

export const Route = createFileRoute("/_app/emplois/$id")({
  head: () => ({ meta: [{ title: "Offre — Campus Jobs" }] }),
  component: JobDetailPage,
});

function JobDetailPage() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const uid = session?.user.id;
  const query = useJobOffer(id);
  const apply = useApply(id, uid);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [answers, setAnswers] = useState<string[]>([]);
  const [cv, setCv] = useState<File | null>(null);
  const [share, setShare] = useState(true);
  const [done, setDone] = useState(false);

  if (query.isLoading) return <div aria-busy className="mx-auto max-w-3xl space-y-3 px-4 py-6"><div className="h-10 w-2/3 animate-pulse rounded bg-foreground/10" /><div className="h-64 animate-pulse rounded-xl bg-foreground/10" /></div>;
  if (query.isError) return isNetworkError(query.error) ? <NetworkErrorScreen onRetry={() => void query.refetch()} /> : <ServerErrorScreen onRetry={() => void query.refetch()} />;
  const o = query.data;
  if (!o) return <StateScreen icon={Briefcase} tone="neutral" title="Offre introuvable" description="Cette offre a été retirée ou n'est plus publiée." actions={<Button asChild><Link to="/emplois">Voir les offres</Link></Button>} />;

  const expired = !!o.deadline && o.deadline < new Date().toISOString().slice(0, 10);
  const own = o.recruiterId === uid;
  const canApply = o.status === "published" && !expired && !own && !o.hasApplied;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <PageHeader title={o.title} breadcrumbs={[{ label: "Campus Jobs", to: "/emplois" }, { label: o.title }]}
        description={undefined} />
      <p className="-mt-3 mb-3 flex items-center gap-1 text-sm text-muted-foreground">{o.organization}{o.verified && <BadgeCheck className="size-4 text-primary" aria-label="Organisation vérifiée" />}</p>
      <JobMeta o={o} />
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Date limite</dt><dd className="font-semibold">{o.deadline ? formatDate(o.deadline) : "Non précisée"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Rémunération</dt><dd className="font-semibold">{o.compensation ?? "Non précisée"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Domaine</dt><dd className="font-semibold">{o.domain ?? "—"}</dd></div>
      </dl>
      <section className="mt-6"><h2 className="font-display text-lg font-bold">Description</h2><p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{o.description}</p></section>
      {o.responsibilities && <section className="mt-5"><h2 className="font-display text-lg font-bold">Missions</h2><p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{o.responsibilities}</p></section>}
      {o.skills.length > 0 && <section className="mt-5"><h2 className="font-display text-lg font-bold">Compétences</h2><p className="mt-2 text-sm">{o.skills.join(" · ")}</p></section>}
      {o.organizationDescription && <section className="mt-5"><h2 className="font-display text-lg font-bold">À propos de {o.organization}</h2><p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{o.organizationDescription}</p></section>}
      <p className="mt-5 rounded-lg bg-secondary p-3 text-xs text-muted-foreground">Ne payez jamais pour obtenir un emploi ou un stage et ne communiquez pas de documents d'identité. En cas de doute, contactez le support.</p>

      <div className="mt-6">
        {done || o.hasApplied ? (
          <InlineAlert tone="success">Votre candidature est envoyée. Suivez son avancement dans <Link to="/emplois/candidatures" className="font-semibold underline">Mes candidatures</Link>.</InlineAlert>
        ) : own ? <InlineAlert tone="info">C'est votre offre. Gérez-la depuis l'espace recruteur.</InlineAlert>
        : !canApply ? <InlineAlert tone="warning">Cette offre n'accepte plus de candidatures.</InlineAlert>
        : !open ? <Button size="lg" onClick={() => setOpen(true)}>Postuler</Button>
        : (
          <form className="space-y-4 rounded-xl border p-4" onSubmit={(e) => { e.preventDefault(); apply.mutate({ message, answers: o.questions.map((_, i) => answers[i] ?? ""), cv, shareProfile: share }, { onSuccess: () => setDone(true) }); }}>
            <h2 className="font-display text-lg font-bold">Votre candidature</h2>
            <Field label="Message au recruteur" hint="Présentez votre motivation (3 000 caractères max)." htmlFor="msg">
              <Textarea id="msg" rows={5} maxLength={3000} value={message} onChange={(e) => setMessage(e.target.value)} />
            </Field>
            {o.questions.map((qn, i) => (
              <Field key={i} label={qn} htmlFor={`q${i}`}>
                <Textarea id={`q${i}`} rows={3} maxLength={2000} value={answers[i] ?? ""} onChange={(e) => setAnswers((a) => { const n = [...a]; n[i] = e.target.value; return n; })} />
              </Field>
            ))}
            <Field label="CV (PDF, 5 Mo max)" htmlFor="cv" hint="Visible uniquement par ce recruteur.">
              <input id="cv" type="file" accept="application/pdf" onChange={(e) => setCv(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-1" />
              <span>Joindre mon profil professionnel (une copie est transmise maintenant ; vos modifications ultérieures ne changent pas cette candidature). <Link to="/emplois/profil" className="font-semibold underline">Modifier mon profil</Link></span>
            </label>
            {apply.isError && <InlineAlert tone="danger">{friendlyError(apply.error, "Impossible d'envoyer la candidature.")}</InlineAlert>}
            <div className="flex gap-2">
              <Button type="submit" disabled={apply.isPending}>{apply.isPending ? "Envoi…" : "Envoyer ma candidature"}</Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
