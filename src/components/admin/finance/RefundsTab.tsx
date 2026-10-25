import { useState } from "react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, InlineAlert } from "@/components/cm/feedback";
import { EmptyScreen, ServerErrorScreen } from "@/components/cm/screens";
import { formatFcfa } from "@/lib/domain";
import { useFinanceActions, useTutoringRefunds, type TutoringRefund } from "@/lib/api/admin-finance";
import { dayFmt, skeleton } from "./shared";

export function RefundsTab({ canEdit }: { canEdit: boolean }) {
  const query = useTutoringRefunds();
  const acts = useFinanceActions();
  const [target, setTarget] = useState<TutoringRefund | null>(null);

  const confirm = async () => {
    if (!target) return;
    try {
      await acts.markTutoringRefunded.mutateAsync(target.id);
      toast.success("Remboursement enregistré : le revenu est annulé.");
    } catch (e) { toast.error(acts.errorText(e)); }
    setTarget(null);
  };

  if (query.isPending) return skeleton;
  if (query.isError) return <ServerErrorScreen compact onRetry={() => void query.refetch()} />;
  const rows = query.data ?? [];

  return (
    <div className="space-y-4">
      <InlineAlert tone="info" title="Séances de tutorat payées puis annulées">
        Remboursez d'abord l'étudiant par Mobile Money, puis marquez le remboursement comme effectué : le paiement passe à « remboursé » et le revenu correspondant est annulé.
        Les remboursements de litiges sur des commandes se traitent dans <Link to="/admin/litiges" className="font-semibold underline">Litiges</Link>.
      </InlineAlert>
      {!canEdit && <InlineAlert tone="info">Marquer un remboursement est réservé aux administrateurs.</InlineAlert>}
      {rows.length === 0 ? <EmptyScreen compact title="Aucun remboursement à effectuer" description="Les séances payées puis annulées apparaîtront ici." /> : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
              <div className="min-w-0 flex-1 basis-56">
                <p className="font-semibold">{r.subject} — {r.studentName}</p>
                <p className="text-xs text-muted-foreground">Tuteur : {r.tutorName}{r.paidAt ? ` · payé le ${dayFmt(r.paidAt)}` : ""}{r.scheduledAt ? ` · séance prévue le ${dayFmt(r.scheduledAt)}` : ""}</p>
              </div>
              <p className="font-bold tabular-nums">{formatFcfa(r.amount)}</p>
              {canEdit && <Button size="sm" onClick={() => setTarget(r)}>Marquer remboursé</Button>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!target} onOpenChange={(o) => !o && setTarget(null)} title={target ? `Rembourser ${formatFcfa(target.amount)} à ${target.studentName} ?` : ""}
        description="Confirmez seulement que le remboursement Mobile Money a bien été effectué. Cette action annule le revenu et ne peut pas être défaite." confirmLabel="Remboursement effectué" onConfirm={confirm} />
    </div>
  );
}
