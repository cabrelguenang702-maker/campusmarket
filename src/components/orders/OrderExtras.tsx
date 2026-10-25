import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill } from "@/components/cm/badges";
import { InlineAlert } from "@/components/cm/feedback";
import { AppLink } from "@/components/cm/app-link";
import { useAuth } from "@/lib/auth";
import { friendlyError } from "@/lib/api/errors";
import { formatDate } from "@/lib/domain";
import { DISPUTE_REASON_LABEL, ORDER_STATUS_LABEL, evidenceUrl, useDisputeActions, useOrderDispute, useOrderHistory, type DisputeReason, type Order } from "@/lib/api/orders";

const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";

export function DisputeDialog({ order, open, onOpenChange }: { order: Order; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { session } = useAuth();
  const { open: openDispute } = useDisputeActions(session?.user.id);
  const [reason, setReason] = useState<DisputeReason>("not_received");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const submit = () => openDispute.mutate({ orderId: order.id, reason, description, files }, {
    onSuccess: () => { toast.success("Litige ouvert", { description: "Le vendeur peut répondre ; notre équipe tranchera." }); onOpenChange(false); setDescription(""); setFiles([]); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display">Signaler un problème</DialogTitle><DialogDescription>{order.productName} · le vendeur sera informé et pourra répondre. Notre équipe tranche ensuite.</DialogDescription></DialogHeader>
        <label className="space-y-1.5 text-sm font-semibold">Motif
          <select className={selectClass} value={reason} onChange={(e) => setReason(e.target.value as DisputeReason)}>
            {Object.entries(DISPUTE_REASON_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-semibold">Description
          <Textarea rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Expliquez ce qui s'est passé (10 caractères minimum)" />
        </label>
        <label className="space-y-1.5 text-sm font-semibold">Preuves (facultatif)
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))} className="block w-full text-sm font-normal" />
          <span className="block text-xs font-normal text-muted-foreground">3 fichiers max (JPG, PNG, WebP, PDF), 5 Mo chacun.</span>
        </label>
        {openDispute.isError && <InlineAlert tone="danger">{friendlyError(openDispute.error, "Impossible d'ouvrir le litige.")}</InlineAlert>}
        <DialogFooter className="gap-2 sm:gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button><Button disabled={description.trim().length < 10 || openDispute.isPending} onClick={submit}>{openDispute.isPending ? "Envoi…" : "Ouvrir le litige"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EvidenceLinks({ paths }: { paths: string[] }) {
  if (paths.length === 0) return null;
  const open = async (p: string) => { try { window.open(await evidenceUrl(p), "_blank", "noopener"); } catch (e) { toast.error(friendlyError(e)); } };
  return <div className="mt-2 flex flex-wrap gap-2">{paths.map((p, i) => <Button key={p} size="sm" variant="outline" onClick={() => void open(p)}>Pièce jointe {i + 1}</Button>)}</div>;
}

export function DisputePanel({ order, kind }: { order: Order; kind: "achat" | "vente" }) {
  const { session } = useAuth();
  const q = useOrderDispute(order.id, true);
  const { respond } = useDisputeActions(session?.user.id);
  const [text, setText] = useState("");
  const d = q.data;
  if (!d) return null;
  const resolved = d.status !== "open";
  return (
    <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Litige · {DISPUTE_REASON_LABEL[d.reason]}</p>
        <Pill tone={resolved ? "success" : "danger"}>{d.status === "open" ? "En cours d'examen" : d.status === "resolved_buyer" ? "Tranché en faveur de l'acheteur" : "Tranché en faveur du vendeur"}</Pill>
      </div>
      <p className="mt-1 whitespace-pre-line text-muted-foreground">{d.description}</p>
      <EvidenceLinks paths={d.evidence} />
      {d.sellerResponse && <p className="mt-2 whitespace-pre-line rounded bg-background p-2"><span className="text-xs font-semibold text-muted-foreground">Réponse du vendeur : </span>{d.sellerResponse}</p>}
      {resolved && d.resolutionNote && <p className="mt-2"><span className="text-xs font-semibold text-muted-foreground">Décision : </span>{d.resolutionNote}</p>}
      {resolved && d.status === "resolved_buyer" && d.refundStatus !== "none" && <p className="mt-1 text-xs text-muted-foreground">Remboursement : {d.refundStatus === "due" ? "en cours de traitement par notre équipe (Mobile Money)" : "effectué"}.</p>}
      {kind === "vente" && d.status === "open" && !d.sellerResponse && (
        <div className="mt-3 space-y-2">
          <Textarea aria-label="Votre réponse" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Votre version des faits (10 caractères minimum, une seule réponse)" />
          {respond.isError && <InlineAlert tone="danger">{friendlyError(respond.error, "Impossible d'envoyer la réponse.")}</InlineAlert>}
          <Button size="sm" disabled={text.trim().length < 10 || respond.isPending} onClick={() => respond.mutate({ disputeId: d.id, text }, { onSuccess: () => toast.success("Réponse envoyée") })}>Répondre</Button>
        </div>
      )}
    </div>
  );
}

export function OrderTimeline({ order, kind, showReceipt }: { order: Order; kind: "achat" | "vente"; showReceipt: boolean }) {
  const q = useOrderHistory(order.id, true);
  return (
    <div className="mt-3 border-t pt-3">
      <ol className="space-y-1 border-l pl-3 text-xs text-muted-foreground">
        {(q.data ?? []).map((e, i) => <li key={i}>{formatDate(e.at)} — {ORDER_STATUS_LABEL[e.status]}</li>)}
      </ol>
      {q.isLoading && <div aria-busy className="h-10 animate-pulse rounded bg-foreground/10" />}
      {showReceipt && <AppLink to={`/profil/recu/${order.id}`} className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">Voir le reçu</AppLink>}
      {order.status === "disputed" || order.status === "cancelled" || order.status === "completed" ? <DisputePanel order={order} kind={kind} /> : null}
    </div>
  );
}
