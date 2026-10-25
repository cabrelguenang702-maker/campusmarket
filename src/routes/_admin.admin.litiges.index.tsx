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
import { formatDate, formatFcfa } from "@/lib/domain";
import { friendlyError } from "@/lib/api/errors";
import { DISPUTE_REASON_LABEL, evidenceUrl, useAdminDisputeActions, useAdminDisputes, type AdminDispute, type DisputeFilter } from "@/lib/api/orders";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export type AdminDisputesSearch = { filtre?: DisputeFilter | undefined };
const FILTERS: [DisputeFilter, string][] = [["open", "À trancher"], ["refund", "Remboursements"], ["resolved", "Tranchés"], ["all", "Tous"]];

export const Route = createFileRoute("/_admin/admin/litiges/")({
  validateSearch: (s: Record<string, unknown>): AdminDisputesSearch => ({ filtre: FILTERS.some(([k]) => k === s["filtre"]) ? (s["filtre"] as DisputeFilter) : undefined }),
  head: () => ({ meta: [{ title: "Litiges — Administration CampusMarket" }] }),
  component: AdminDisputesPage,
});

function AdminDisputesPage() {
  const { filtre } = Route.useSearch();
  const filter = filtre ?? "open";
  const navigate = useNavigate({ from: Route.fullPath });
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin") || roles.includes("super_admin");
  const query = useAdminDisputes(filter);
  const { resolve, refunded } = useAdminDisputeActions();
  const [target, setTarget] = useState<{ d: AdminDispute; outcome: "buyer" | "seller" } | null>(null);
  const [note, setNote] = useState("");
  const err = resolve.error ?? refunded.error;
  const openEvidence = async (p: string) => { try { window.open(await evidenceUrl(p), "_blank", "noopener"); } catch (e) { toast.error(friendlyError(e)); } };

  if (query.isError) return <ServerErrorScreen onRetry={() => void query.refetch()} />;
  const items = query.data ?? [];
  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader title="Litiges" description="Tranchez les litiges entre acheteurs et vendeurs. Une décision en faveur de l'acheteur annule la commande ; le remboursement Mobile Money se fait ensuite à la main (CamPay ne rembourse pas)." />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b" role="tablist">
        {FILTERS.map(([id, label]) => <button key={id} role="tab" aria-selected={filter === id} onClick={() => void navigate({ search: id === "open" ? {} : { filtre: id } })} className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold", filter === id ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>{label}</button>)}
      </div>
      {err != null && <div className="mb-3"><InlineAlert tone="danger">{friendlyError(err, "Action impossible.")}</InlineAlert></div>}
      {query.isLoading ? <div aria-busy className="h-40 animate-pulse rounded-xl bg-foreground/10" /> : items.length === 0 ? <EmptyScreen compact title="Aucun litige ici" /> : (
        <ul className="space-y-3">
          {items.map((d) => (
            <li key={d.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><p className="font-semibold">{d.product ?? "Annonce supprimée"}{d.quantity > 1 ? ` × ${d.quantity}` : ""} · {formatFcfa(d.total)}</p><p className="text-xs text-muted-foreground">Acheteur : {d.buyer ?? "—"} · Vendeur : {d.seller ?? "—"} · ouvert le {formatDate(d.createdAt)}</p></div>
                <Pill tone={d.status === "open" ? "danger" : "success"}>{d.status === "open" ? "À trancher" : d.status === "resolved_buyer" ? "Pour l'acheteur" : "Pour le vendeur"}</Pill>
              </div>
              <p className="mt-2 text-sm font-medium">{DISPUTE_REASON_LABEL[d.reason]}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{d.description}</p>
              {d.evidence.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{d.evidence.map((p, i) => <Button key={p} size="sm" variant="outline" onClick={() => void openEvidence(p)}>Pièce {i + 1}</Button>)}</div>}
              <p className="mt-2 whitespace-pre-line rounded bg-secondary p-2 text-sm">{d.sellerResponse ? <><span className="text-xs font-semibold text-muted-foreground">Réponse du vendeur : </span>{d.sellerResponse}</> : <span className="text-muted-foreground">Le vendeur n'a pas encore répondu.</span>}</p>
              {d.resolutionNote && <p className="mt-2 text-sm"><span className="text-xs font-semibold text-muted-foreground">Décision : </span>{d.resolutionNote}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {d.status === "open" && <><Button size="sm" onClick={() => { setTarget({ d, outcome: "buyer" }); setNote(""); }}>Donner raison à l'acheteur</Button><Button size="sm" variant="outline" onClick={() => { setTarget({ d, outcome: "seller" }); setNote(""); }}>Donner raison au vendeur</Button></>}
                {d.refundStatus === "due" && (isAdmin
                  ? <Button size="sm" variant="secondary" disabled={refunded.isPending} onClick={() => refunded.mutate(d.id, { onSuccess: () => toast.success("Remboursement noté comme effectué") })}>Marquer comme remboursé</Button>
                  : <Pill tone="warning">Remboursement à effectuer par un administrateur</Pill>)}
                {d.refundStatus === "done" && <Pill tone="success">Remboursé</Pill>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={target !== null} onOpenChange={(o) => { if (!o) setTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{target?.outcome === "buyer" ? "Donner raison à l'acheteur" : "Donner raison au vendeur"}</DialogTitle><DialogDescription>{target?.outcome === "buyer" ? "La commande sera annulée et un remboursement sera à effectuer." : "La commande sera clôturée comme terminée."} Cette décision est définitive.</DialogDescription></DialogHeader>
          <Textarea aria-label="Justification" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Justification visible des deux parties (5 caractères minimum)" />
          <DialogFooter><Button variant="outline" onClick={() => setTarget(null)}>Annuler</Button><Button disabled={note.trim().length < 5 || resolve.isPending} onClick={() => { if (target) resolve.mutate({ id: target.d.id, outcome: target.outcome, note }, { onSuccess: () => { setTarget(null); toast.success("Décision enregistrée"); } }); }}>Confirmer la décision</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
