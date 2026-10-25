import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { StateScreen } from "@/components/cm/feedback";
import { NetworkErrorScreen } from "@/components/cm/screens";
import { FileDetail as FileText } from "@/components/icons";
import { formatDate, formatFcfa } from "@/lib/domain";
import { isNetworkError } from "@/lib/api/errors";
import { useReceipt } from "@/lib/api/orders";

export const Route = createFileRoute("/_app/profil/recu/$id")({
  head: () => ({ meta: [{ title: "Reçu — CampusMarket" }, { name: "robots", content: "noindex" }] }),
  component: ReceiptPage,
});

function ReceiptPage() {
  const { id } = Route.useParams();
  const q = useReceipt(id);
  if (q.isLoading) return <div aria-busy className="mx-auto h-72 max-w-lg animate-pulse rounded-xl bg-foreground/10" />;
  if (q.isError) {
    return isNetworkError(q.error) ? <NetworkErrorScreen onRetry={() => void q.refetch()} />
      : <StateScreen icon={FileText} tone="neutral" title="Reçu indisponible" description={q.error instanceof Error ? q.error.message : "Ce reçu n'existe pas ou le paiement n'est pas confirmé."} actions={<Button asChild><Link to="/profil/achats">Mes achats</Link></Button>} />;
  }
  const r = q.data!;
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <article className="rounded-xl border bg-card p-6 print:border-0 print:shadow-none">
        <header className="flex items-start justify-between gap-3 border-b pb-4">
          <div><p className="font-display text-lg font-bold">CampusMarket</p><p className="text-xs text-muted-foreground">Reçu de paiement</p></div>
          <div className="text-right"><p className="text-sm font-semibold">{r.number}</p><p className="text-xs text-muted-foreground">Payé le {formatDate(r.paidAt)}</p></div>
        </header>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Acheteur</dt><dd className="font-semibold">{r.buyer}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Vendeur</dt><dd className="font-semibold">{r.seller}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Commande du</dt><dd className="font-semibold">{formatDate(r.orderedAt)}</dd></div>
        </dl>
        <table className="mt-5 w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 font-medium">Article</th><th className="py-2 text-right font-medium">Qté</th><th className="py-2 text-right font-medium">Prix unitaire</th></tr></thead>
          <tbody><tr><td className="py-2">{r.product}</td><td className="py-2 text-right">{r.quantity}</td><td className="py-2 text-right">{formatFcfa(r.unitPrice)}</td></tr></tbody>
        </table>
        <div className="mt-3 space-y-1 border-t pt-3 text-sm">
          <p className="flex justify-between"><span>Sous-total</span><span>{formatFcfa(r.unitPrice * r.quantity)}</span></p>
          <p className="flex justify-between"><span>Frais de service</span><span>{formatFcfa(r.serviceFee)}</span></p>
          <p className="flex justify-between font-display text-base font-bold"><span>Total payé</span><span>{formatFcfa(r.total)}</span></p>
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground">Paiement par Mobile Money en francs CFA (XAF). Ce reçu atteste du paiement enregistré par CampusMarket ; il ne vaut pas facture du vendeur.</p>
      </article>
      <div className="mt-4 flex gap-2 print:hidden"><Button onClick={() => window.print()}>Imprimer / enregistrer en PDF</Button><Button asChild variant="outline"><Link to="/profil/achats">Retour</Link></Button></div>
    </div>
  );
}
