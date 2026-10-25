import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/cm/badges";
import { ConfirmDialog, InlineAlert } from "@/components/cm/feedback";
import { EmptyScreen, NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { JobsTabs } from "@/components/jobs/JobBits";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/domain";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { APPLICATION_STATUS_LABEL, useMyApplications, useWithdraw, type ApplicationStatus } from "@/lib/api/jobs";

export const Route = createFileRoute("/_app/emplois/candidatures")({
  head: () => ({ meta: [{ title: "Mes candidatures — Campus Jobs" }] }),
  component: MyApplicationsPage,
});

const tone = (s: ApplicationStatus) => (s === "accepted" ? "success" : s === "rejected" ? "danger" : s === "withdrawn" ? "neutral" : s === "received" ? "info" : "primary") as "success" | "danger" | "neutral" | "info" | "primary";

function MyApplicationsPage() {
  const { session } = useAuth();
  const query = useMyApplications(session?.user.id);
  const withdraw = useWithdraw();
  const [target, setTarget] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <PageHeader kicker="Campus Jobs" title="Mes candidatures" />
      <JobsTabs active="candidatures" />
      {withdraw.isError && <div className="mb-3"><InlineAlert tone="danger">{friendlyError(withdraw.error, "Impossible de retirer la candidature.")}</InlineAlert></div>}
      {query.isLoading ? <div aria-busy className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-foreground/10" />)}</div>
        : query.isError ? (isNetworkError(query.error) ? <NetworkErrorScreen onRetry={() => void query.refetch()} /> : <ServerErrorScreen onRetry={() => void query.refetch()} />)
        : (query.data ?? []).length === 0 ? <EmptyScreen title="Aucune candidature" description="Postulez à une offre pour suivre son avancement ici." actions={<Button asChild><Link to="/emplois">Voir les offres</Link></Button>} />
        : (
          <ul className="space-y-3">
            {(query.data ?? []).map((a) => (
              <li key={a.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to="/emplois/$id" params={{ id: a.offerId }} className="font-display font-bold hover:underline">{a.title}</Link>
                    <p className="text-sm text-muted-foreground">{a.organization} · envoyée le {formatDate(a.createdAt)}</p>
                  </div>
                  <Pill tone={tone(a.status)}>{APPLICATION_STATUS_LABEL[a.status]}</Pill>
                </div>
                <ol className="mt-3 space-y-1 border-l pl-3 text-xs text-muted-foreground">
                  {a.events.map((e, i) => <li key={i}>{formatDate(e.at)} — {APPLICATION_STATUS_LABEL[e.status]}</li>)}
                </ol>
                {!["accepted", "rejected", "withdrawn"].includes(a.status) && <Button variant="outline" size="sm" className="mt-3" onClick={() => setTarget(a.id)}>Retirer ma candidature</Button>}
              </li>
            ))}
          </ul>
        )}
      <ConfirmDialog open={target !== null} onOpenChange={(o) => { if (!o) setTarget(null); }} title="Retirer cette candidature ?" description="Le recruteur sera informé que vous ne souhaitez plus être considéré. Vous ne pourrez pas postuler de nouveau à cette offre."
        confirmLabel="Retirer" destructive onConfirm={() => { if (target) withdraw.mutate(target); setTarget(null); }} />
    </div>
  );
}
