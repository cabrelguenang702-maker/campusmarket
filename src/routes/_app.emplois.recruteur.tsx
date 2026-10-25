import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, IconInput } from "@/components/cm/forms";
import { Pill } from "@/components/cm/badges";
import { ConfirmDialog, InlineAlert } from "@/components/cm/feedback";
import { ServerErrorScreen } from "@/components/cm/screens";
import { ApplicationsPanel } from "@/components/jobs/ApplicationsPanel";
import { JobsTabs } from "@/components/jobs/JobBits";
import { OfferForm } from "@/components/jobs/OfferForm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Plus } from "@/components/icons";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/domain";
import { friendlyError } from "@/lib/api/errors";
import { emptyOffer, KIND_LABEL, OFFER_STATUS_LABEL, RECRUITER_STATUS_LABEL, useMyOffers, useMyRecruiter, useOfferActions, useRequestRecruiter, type MyOffer, type OfferStatus } from "@/lib/api/jobs";

export const Route = createFileRoute("/_app/emplois/recruteur")({
  head: () => ({ meta: [{ title: "Espace recruteur — Campus Jobs" }] }),
  component: RecruiterPage,
});

const statusTone = (s: OfferStatus) => (s === "published" ? "success" : s === "rejected" || s === "suspended" ? "danger" : s === "pending_review" ? "warning" : "neutral") as "success" | "danger" | "warning" | "neutral";

function RequestForm({ uid, initial }: { uid: string; initial?: { organization: string; website: string | null; description: string | null } | undefined }) {
  const req = useRequestRecruiter(uid);
  const [org, setOrg] = useState(initial?.organization ?? "");
  const [web, setWeb] = useState(initial?.website ?? "");
  const [desc, setDesc] = useState(initial?.description ?? "");
  return (
    <form className="space-y-4 rounded-xl border p-4" onSubmit={(e) => { e.preventDefault(); req.mutate({ organization: org, website: web, description: desc }, { onSuccess: () => toast.success("Demande envoyée") }); }}>
      <Field label="Nom de l'organisation" htmlFor="org"><IconInput id="org" maxLength={150} value={org} onChange={(e) => setOrg(e.target.value)} required /></Field>
      <Field label="Site web" htmlFor="web" hint="Facilite la vérification"><IconInput id="web" type="url" placeholder="https://" value={web} onChange={(e) => setWeb(e.target.value)} /></Field>
      <Field label="Présentation" htmlFor="rdesc"><Textarea id="rdesc" rows={4} maxLength={2000} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      {req.isError && <InlineAlert tone="danger">{friendlyError(req.error, "Impossible d'envoyer la demande.")}</InlineAlert>}
      <Button type="submit" disabled={req.isPending}>{req.isPending ? "Envoi…" : "Envoyer la demande"}</Button>
    </form>
  );
}

function RecruiterPage() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const rec = useMyRecruiter(uid);
  const active = rec.data?.status === "pending" || rec.data?.status === "verified";
  const offers = useMyOffers(active ? uid : undefined);
  const actions = useOfferActions(uid);
  const [editing, setEditing] = useState<MyOffer | "new" | null>(null);
  const [openApps, setOpenApps] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: "close" | "delete" } | null>(null);

  if (rec.isError) return <ServerErrorScreen onRetry={() => void rec.refetch()} />;
  const flash = (m: string) => () => toast.success(m);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <PageHeader kicker="Campus Jobs" title="Espace recruteur" description="Publiez des offres et suivez les candidatures. Les offres d'une organisation non vérifiée sont relues avant publication." />
      <JobsTabs active="recruteur" />
      {rec.isLoading ? <div aria-busy className="h-32 animate-pulse rounded-xl bg-foreground/10" />
      : !rec.data ? (<><p className="mb-3 text-sm text-muted-foreground">Demandez l'ouverture de votre espace recruteur : notre équipe vérifie l'organisation.</p><RequestForm uid={uid!} /></>)
      : rec.data.status === "suspended" ? <InlineAlert tone="danger" title="Espace suspendu">{rec.data.reason ?? "Contactez le support pour en savoir plus."}</InlineAlert>
      : rec.data.status === "rejected" ? (<><InlineAlert tone="danger" title="Demande refusée">{rec.data.reason ?? "Votre demande n'a pas été retenue."} Vous pouvez la corriger et la renvoyer.</InlineAlert><div className="mt-3"><RequestForm uid={uid!} initial={rec.data} /></div></>)
      : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm"><strong>{rec.data.organization}</strong> · <Pill tone={rec.data.status === "verified" ? "success" : "warning"}>{RECRUITER_STATUS_LABEL[rec.data.status]}</Pill></p>
            {!editing && <Button onClick={() => setEditing("new")}><Plus /> Nouvelle offre</Button>}
          </div>
          {editing && (
            <div className="mb-5">
              <OfferForm initial={editing === "new" ? emptyOffer : editing} pending={actions.save.isPending} error={actions.save.error} onCancel={() => { setEditing(null); actions.save.reset(); }}
                onSubmit={(draft) => actions.save.mutate({ id: editing === "new" ? undefined : editing.id, draft }, { onSuccess: () => { setEditing(null); toast.success("Brouillon enregistré"); } })} />
            </div>
          )}
          {actions.submit.isError && <div className="mb-3"><InlineAlert tone="danger">{friendlyError(actions.submit.error)}</InlineAlert></div>}
          {actions.setState.isError && <div className="mb-3"><InlineAlert tone="danger">{friendlyError(actions.setState.error)}</InlineAlert></div>}
          {offers.isLoading ? <div aria-busy className="h-24 animate-pulse rounded-xl bg-foreground/10" />
          : (offers.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Aucune offre. Créez votre première offre.</p>
          : (
            <ul className="space-y-3">
              {(offers.data ?? []).map((o) => (
                <li key={o.id} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0"><p className="font-display font-bold">{o.title}</p><p className="text-xs text-muted-foreground">{KIND_LABEL[o.kind]}{o.deadline ? ` · limite ${formatDate(o.deadline)}` : ""} · {o.applications} candidature(s)</p></div>
                    <Pill tone={statusTone(o.status)}>{OFFER_STATUS_LABEL[o.status]}</Pill>
                  </div>
                  {o.statusReason && (o.status === "rejected" || o.status === "suspended") && <p className="mt-2 text-xs text-destructive">Motif : {o.statusReason}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(o.status === "draft" || o.status === "rejected") && <Button size="sm" variant="outline" onClick={() => setEditing(o)}>Modifier</Button>}
                    {(o.status === "draft" || o.status === "rejected") && <Button size="sm" disabled={actions.submit.isPending} onClick={() => actions.submit.mutate(o.id, { onSuccess: (r) => toast.success(r.status === "published" ? "Offre publiée" : "Offre envoyée en vérification") })}>Soumettre</Button>}
                    {o.status === "published" && <Button size="sm" variant="outline" onClick={() => setConfirm({ id: o.id, kind: "close" })}>Clôturer</Button>}
                    {(o.status === "published" || o.status === "pending_review") && <Button size="sm" variant="outline" onClick={() => actions.setState.mutate({ id: o.id, state: "draft" }, { onSuccess: flash("Repassée en brouillon") })}>Repasser en brouillon</Button>}
                    {(o.status === "closed" || o.status === "rejected") && <Button size="sm" variant="ghost" onClick={() => actions.setState.mutate({ id: o.id, state: "archived" })}>Archiver</Button>}
                    {o.status === "draft" && o.applications === 0 && <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: o.id, kind: "delete" })}>Supprimer</Button>}
                    {o.applications > 0 && <Button size="sm" variant="secondary" onClick={() => setOpenApps(openApps === o.id ? null : o.id)}>{openApps === o.id ? "Masquer" : "Voir"} les candidatures</Button>}
                  </div>
                  {openApps === o.id && <div className="mt-4"><ApplicationsPanel offerId={o.id} /></div>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <ConfirmDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={confirm?.kind === "delete" ? "Supprimer ce brouillon ?" : "Clôturer cette offre ?"}
        description={confirm?.kind === "delete" ? "Cette action est définitive." : "L'offre ne sera plus visible et n'acceptera plus de candidatures. Les candidatures reçues restent consultables."}
        confirmLabel={confirm?.kind === "delete" ? "Supprimer" : "Clôturer"} destructive
        onConfirm={() => { if (confirm?.kind === "delete") actions.remove.mutate(confirm.id); else if (confirm) actions.setState.mutate({ id: confirm.id, state: "closed" }); setConfirm(null); }} />
    </div>
  );
}
