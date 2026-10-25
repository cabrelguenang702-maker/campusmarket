import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill } from "@/components/cm/badges";
import { InlineAlert } from "@/components/cm/feedback";
import { EmptyScreen, ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatDate } from "@/lib/domain";
import { friendlyError } from "@/lib/api/errors";
import { KIND_LABEL, OFFER_STATUS_LABEL, RECRUITER_STATUS_LABEL, useAdminJobActions, useAdminJobs } from "@/lib/api/jobs";
import { cn } from "@/lib/utils";

export type AdminJobsSearch = { onglet?: "offres" | undefined };

export const Route = createFileRoute("/_admin/admin/emplois/")({
  validateSearch: (s: Record<string, unknown>): AdminJobsSearch => ({ onglet: s["onglet"] === "offres" ? "offres" : undefined }),
  head: () => ({ meta: [{ title: "Campus Jobs — Administration CampusMarket" }] }),
  component: AdminJobsPage,
});

type Pending =
  | { type: "recruiter"; userId: string; status: "rejected" | "suspended"; label: string }
  | { type: "offer"; id: string; decision: "reject" | "suspend"; label: string };

function AdminJobsPage() {
  const { onglet } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const tab = onglet ?? "recruteurs";
  const query = useAdminJobs();
  const { reviewRecruiter, reviewOffer } = useAdminJobActions();
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const err = reviewRecruiter.error ?? reviewOffer.error;

  const submitReason = () => {
    if (!pending) return;
    const done = { onSuccess: () => { setPending(null); setReason(""); toast.success("Décision enregistrée"); } };
    if (pending.type === "recruiter") reviewRecruiter.mutate({ userId: pending.userId, status: pending.status, reason }, done);
    else reviewOffer.mutate({ id: pending.id, decision: pending.decision, reason }, done);
  };
  const ok = (m: string) => ({ onSuccess: () => toast.success(m) });

  if (query.isError) return <ServerErrorScreen onRetry={() => void query.refetch()} />;
  const recruiters = query.data?.recruiters ?? [];
  const offers = query.data?.offers ?? [];
  const toReview = offers.filter((o) => o.status === "pending_review").length;
  const pendingRec = recruiters.filter((r) => r.status === "pending").length;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader title="Campus Jobs" description="Vérifiez les organisations et relisez les offres avant publication." />
      <div className="mb-4 flex gap-1 border-b" role="tablist">
        {([["recruteurs", `Recruteurs${pendingRec ? ` (${pendingRec})` : ""}`], ["offres", `Offres${toReview ? ` (${toReview})` : ""}`]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => void navigate({ search: id === "offres" ? { onglet: "offres" } : {} })} className={cn("border-b-2 px-3 py-2 text-sm font-semibold", tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>{label}</button>
        ))}
      </div>
      {err != null && <div className="mb-3"><InlineAlert tone="danger">{friendlyError(err, "Action impossible.")}</InlineAlert></div>}
      {query.isLoading ? <div aria-busy className="h-40 animate-pulse rounded-xl bg-foreground/10" />
      : tab === "recruteurs" ? (
        recruiters.length === 0 ? <EmptyScreen compact title="Aucun recruteur" /> : (
          <ul className="space-y-2">
            {recruiters.map((r) => (
              <li key={r.userId} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><p className="font-semibold">{r.organization}</p><p className="text-xs text-muted-foreground">Demande du {formatDate(r.createdAt)}{r.website ? " · " : ""}{r.website && <a href={r.website} target="_blank" rel="noopener noreferrer nofollow" className="underline">{r.website}</a>}</p></div>
                  <Pill tone={r.status === "verified" ? "success" : r.status === "pending" ? "warning" : "danger"}>{RECRUITER_STATUS_LABEL[r.status]}</Pill>
                </div>
                {r.description && <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{r.description}</p>}
                {r.reason && <p className="mt-1 text-xs text-destructive">Motif : {r.reason}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.status !== "verified" && r.status !== "suspended" && <Button size="sm" disabled={reviewRecruiter.isPending} onClick={() => reviewRecruiter.mutate({ userId: r.userId, status: "verified", reason: "" }, ok("Organisation vérifiée"))}>Vérifier</Button>}
                  {r.status === "suspended" && <Button size="sm" variant="outline" onClick={() => reviewRecruiter.mutate({ userId: r.userId, status: "verified", reason: "" }, ok("Organisation réactivée"))}>Réactiver</Button>}
                  {r.status === "pending" && <Button size="sm" variant="outline" onClick={() => setPending({ type: "recruiter", userId: r.userId, status: "rejected", label: `Refuser ${r.organization}` })}>Refuser</Button>}
                  {r.status === "verified" && <Button size="sm" variant="outline" onClick={() => setPending({ type: "recruiter", userId: r.userId, status: "suspended", label: `Suspendre ${r.organization}` })}>Suspendre</Button>}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : offers.length === 0 ? <EmptyScreen compact title="Aucune offre à examiner" /> : (
        <ul className="space-y-2">
          {offers.map((o) => (
            <li key={o.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><p className="font-semibold">{o.title}</p><p className="text-xs text-muted-foreground">{o.organization} · {KIND_LABEL[o.kind]} · {[o.city, o.countryCode].filter(Boolean).join(", ") || "À distance"}</p></div>
                <Pill tone={o.status === "published" ? "success" : o.status === "pending_review" ? "warning" : "danger"}>{OFFER_STATUS_LABEL[o.status]}</Pill>
              </div>
              <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-muted-foreground">{o.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {o.status === "pending_review" && <><Button size="sm" disabled={reviewOffer.isPending} onClick={() => reviewOffer.mutate({ id: o.id, decision: "approve", reason: "" }, ok("Offre publiée"))}>Approuver</Button><Button size="sm" variant="outline" onClick={() => setPending({ type: "offer", id: o.id, decision: "reject", label: `Refuser « ${o.title} »` })}>Refuser</Button></>}
                {o.status === "published" && <Button size="sm" variant="outline" onClick={() => setPending({ type: "offer", id: o.id, decision: "suspend", label: `Suspendre « ${o.title} »` })}>Suspendre</Button>}
                {o.status === "suspended" && <Button size="sm" variant="outline" onClick={() => reviewOffer.mutate({ id: o.id, decision: "restore", reason: "" }, ok("Offre rétablie"))}>Rétablir</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={pending !== null} onOpenChange={(o) => { if (!o) { setPending(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{pending?.label}</DialogTitle><DialogDescription>Le motif est communiqué au recruteur et conservé dans le journal d'audit.</DialogDescription></DialogHeader>
          <Textarea aria-label="Motif" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif (3 caractères minimum)" />
          <DialogFooter><Button variant="outline" onClick={() => setPending(null)}>Annuler</Button><Button disabled={reason.trim().length < 3 || reviewRecruiter.isPending || reviewOffer.isPending} onClick={submitReason}>Confirmer</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
