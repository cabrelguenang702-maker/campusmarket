import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, Check, CheckCircle, Handshake, Search, Truck, X } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { LocationBadge } from "@/components/cm/badges";
import { ProductCard, ProductCardSkeleton } from "@/components/cm/commerce";
import { ConfirmDialog, Spinner, StateScreen } from "@/components/cm/feedback";
import { Field, SelectableCard } from "@/components/cm/forms";
import { PaymentFlow, type PaymentMethod } from "@/components/cm/payment";
import { NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { Stepper } from "@/components/cm/stepper";
import { OrderSummary, QuantityStepper } from "@/components/marketplace/OrderSummary";
import { PageHeader } from "@/components/layout/PageHeader";
import { CAMEROON, formatFcfa } from "@/lib/domain";
import { useProduct, useSimilarListings } from "@/lib/api/products";
import { createOrder, useMyPendingOrder, useOrderActions, type Order } from "@/lib/api/orders";
import { usePaymentProcess } from "@/lib/api/payments";
import { findOrCreateConversation } from "@/lib/api/engagement";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app/produit/$id/acheter")({
  head: () => ({ meta: [{ title: "Finaliser votre achat — CampusMarket" }] }),
  component: CheckoutPage,
});

type Stage = "recap" | "infos" | "paiement" | "commande" | "annulee";

const steps = ["Récapitulatif", "Informations", "Paiement", "Confirmation"] as const;
const meetingPoints = ["Bibliothèque universitaire", "Cafétéria centrale", "Entrée principale du campus", "Amphi 250", "Autre lieu à convenir"];

function CheckoutPage() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const userId = session?.user.id;
  const navigate = useNavigate();
  const productQuery = useProduct(id);
  const product = productQuery.data ?? undefined;
  const pendingQuery = useMyPendingOrder(userId, id);
  const similarQuery = useSimilarListings(product);
  const actions = useOrderActions();
  const qc = useQueryClient();

  const [stage, setStage] = useState<Stage>("recap");
  const [order, setOrder] = useState<Order | null>(null);
  const [qty, setQty] = useState(1);
  const [meeting, setMeeting] = useState(meetingPoints[0] ?? "");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("mtn");
  const [phone, setPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const keyRef = useRef(crypto.randomUUID());
  const resumed = useRef(false);

  const payment = usePaymentProcess({
    kind: "order", targetId: order?.id,
    onConfirmed: () => { for (const key of ["orders", "order", "pending-order", "product", "listings"]) void qc.invalidateQueries({ queryKey: [key] }); },
  });

  // Reprise d'une commande déjà ouverte (achat commencé, ou offre acceptée) : on repart directement au paiement.
  // Si sa réservation de stock est échue, elle ne vaut plus rien : on l'annule et on repart d'un achat neuf.
  useEffect(() => {
    if (resumed.current || pendingQuery.isLoading || pendingQuery.isError) return;
    const pending = pendingQuery.data;
    if (!pending) { resumed.current = true; return; }
    resumed.current = true;
    if (pending.reservedUntil) {
      setOrder(pending); setQty(pending.quantity); setStage("paiement");
    } else {
      actions.cancel.mutate(pending.id, { onSettled: () => { void pendingQuery.refetch(); } });
    }
  }, [pendingQuery.isLoading, pendingQuery.isError, pendingQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <PageHeader kicker="Commande" title={stage === "commande" ? "Commande confirmée" : "Finaliser votre achat"} breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Marketplace", to: "/marketplace" }, ...(product ? [{ label: product.name, to: `/produit/${product.id}` }] : []), { label: "Commande" }]} />
  );

  if (productQuery.isLoading || pendingQuery.isLoading || (pendingQuery.data && !resumed.current)) {
    return <div>{header}<div className="grid place-items-center py-16"><Spinner /></div></div>;
  }
  if (productQuery.isError) {
    return <div>{header}{isNetworkError(productQuery.error) ? <NetworkErrorScreen compact onRetry={() => void productQuery.refetch()} /> : <ServerErrorScreen compact onRetry={() => void productQuery.refetch()} />}</div>;
  }
  if (!product) {
    return <div>{header}<StateScreen icon={Search} title="Annonce introuvable" description="Impossible de démarrer la commande : cette annonce n'existe plus." actions={<Button asChild size="lg"><AppLink to="/marketplace">Retour à la marketplace</AppLink></Button>} /></div>;
  }

  const isOwner = product.sellerId === userId;
  const buyable = product.status === "published" && product.stock !== "sold" && product.stock !== "expired" && product.stock !== "reserved" && product.quantity >= 1 && !isOwner;
  const similar = (similarQuery.data ?? []).filter((p) => p.stock === "available" || p.stock === "low").slice(0, 2);

  if (!order && !buyable && stage !== "annulee") {
    return (
      <div>
        {header}
        <StateScreen icon={X} tone="danger" title={isOwner ? "C'est votre annonce" : "Ce produit n'est plus disponible"}
          description={isOwner ? "Vous ne pouvez pas acheter votre propre annonce." : product.stock === "reserved" ? "Un autre acheteur vient de le réserver. Aucun paiement n'a été effectué." : "Il a été vendu ou retiré. Aucun paiement n'a été effectué."}
          actions={<><Button asChild size="lg"><AppLink to="/marketplace" search={{ categorie: product.category }}>Voir des articles similaires</AppLink></Button><Button asChild size="lg" variant="outline"><AppLink to={`/produit/${product.id}`}><ArrowLeft /> Retour à l'annonce</AppLink></Button></>} />
        {similarQuery.isLoading ? <div className="mx-auto mt-4 grid max-w-2xl gap-4 sm:grid-cols-2"><ProductCardSkeleton /><ProductCardSkeleton /></div> : similar.length > 0 && <div className="mx-auto mt-4 grid max-w-2xl gap-4 sm:grid-cols-2">{similar.map((p) => <ProductCard key={p.id} product={p} />)}</div>}
      </div>
    );
  }

  const unit = order?.unitPrice ?? product.price;
  const shownQty = order?.quantity ?? qty;
  const summary = <OrderSummary product={product} unitPrice={unit} qty={shownQty} fee={order?.serviceFee} />;
  const orderNumber = order ? `CM-${order.id.slice(0, 8).toUpperCase()}` : "";
  const total = order?.total ?? shownQty * unit + Math.round(shownQty * unit * 0.02);
  const current = stage === "recap" ? 1 : stage === "infos" ? 2 : stage === "paiement" ? 3 : 4;
  const cancelable = stage === "recap" || stage === "infos" || stage === "paiement";

  const goPayment = async () => {
    if (!userId) return;
    setCreating(true);
    try {
      const created = await createOrder({ userId, productId: product.id, quantity: qty, meetingPoint: meeting, note, idempotencyKey: keyRef.current });
      setOrder(created);
      setStage("paiement");
    } catch (e) {
      keyRef.current = crypto.randomUUID();
      toast.error(friendlyError(e, "Impossible de créer la commande. Réessayez."));
      void productQuery.refetch();
    } finally {
      setCreating(false);
    }
  };

  const cancelOrder = () => {
    if (!order) { setStage("annulee"); return; }
    actions.cancel.mutate(order.id, {
      onSuccess: () => { setStage("annulee"); setOrder(null); payment.reset(); keyRef.current = crypto.randomUUID(); },
      onError: (e) => toast.error(friendlyError(e, "Impossible d'annuler la commande.")),
    });
  };

  const contactSeller = async () => {
    if (!userId) return;
    try {
      const convId = await findOrCreateConversation(userId, product.sellerId, product.id);
      void navigate({ to: `/messages/${convId}` as "/" });
    } catch (e) {
      toast.error(friendlyError(e, "Impossible d'ouvrir la conversation."));
    }
  };

  if (stage === "annulee") {
    return (
      <div>
        {header}
        <StateScreen icon={X} tone="neutral" title="Commande annulée" description="Votre commande a été annulée. Aucun montant n'a été débité. L'article reste disponible tant qu'il n'est pas acheté."
          actions={<><Button size="lg" onClick={() => { setStage("recap"); void productQuery.refetch(); }}>Reprendre la commande</Button><Button asChild size="lg" variant="outline"><AppLink to={`/produit/${product.id}`}>Retour à l'annonce</AppLink></Button></>} />
      </div>
    );
  }

  if (stage === "commande" && order) {
    return (
      <div>
        {header}
        <Stepper steps={steps} current={4} className="mb-8 max-w-3xl" />
        <div className="mx-auto max-w-2xl">
          <StateScreen compact icon={CheckCircle} tone="success" title="Merci pour votre achat !" description={`Votre commande ${orderNumber} est confirmée. ${product.sellerName} a été prévenu(e).`} className="pt-0" />
          <ol className="space-y-3 rounded-xl border border-border bg-card p-5">
            {[["Le vendeur est notifié", "Il confirme la remise de l'article."], ["Convenez d'un rendez-vous", `Échangez via la messagerie. Lieu proposé : ${order.meetingPoint ?? meeting}.`], ["Vérifiez et confirmez la réception", "Confirmez dans l'application une fois l'article en main."]].map(([t, d], i) => (
              <li key={t} className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/12 text-xs font-bold text-primary">{i === 0 ? <Check className="size-4" /> : i + 1}</span><span><span className="block text-sm font-semibold">{t}</span><span className="block text-xs text-muted-foreground">{d}</span></span></li>
            ))}
          </ol>
          <div className="mt-4"><OrderSummary product={product} unitPrice={order.unitPrice} qty={order.quantity} fee={order.serviceFee} title="Récapitulatif" /></div>
          <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
            <Button size="lg" onClick={() => void contactSeller()}>Contacter le vendeur</Button>
            <Button asChild size="lg" variant="outline"><AppLink to="/profil" search={{ onglet: "achats" }}>Voir mes achats</AppLink></Button>
          </div>
          <Button asChild variant="ghost" className="mt-2 w-full"><AppLink to="/marketplace">Continuer mes achats</AppLink></Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}
      <Stepper steps={steps} current={current} className="mb-8 max-w-3xl" />
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 max-w-2xl">
          {stage === "recap" && (
            <div>
              <h2 className="font-display text-lg font-bold">Récapitulatif de votre commande</h2>
              <div className="mt-4 rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{product.name}</p><LocationBadge campus={product.campus} city={product.city} className="mt-1" /></div><p className="shrink-0 font-display font-bold text-primary">{formatFcfa(product.price)}</p></div>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-sm"><span className="text-muted-foreground">Quantité{product.quantity > 1 ? ` (${product.quantity} disponibles)` : ""}</span><QuantityStepper value={qty} max={Math.min(product.quantity, 5)} onChange={setQty} /></div>
              </div>
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm"><Handshake className="mt-0.5 size-5 shrink-0 text-primary" /><div><p className="font-semibold">Remise en main propre</p><p className="mt-0.5 text-muted-foreground">Vous convenez du lieu et de l'heure avec {product.sellerName} sur le campus {product.campus}.</p></div></div>
              <Button size="lg" className="mt-6 w-full" onClick={() => setStage("infos")}>Continuer <ArrowRight /></Button>
            </div>
          )}

          {stage === "infos" && (
            <div>
              <h2 className="font-display text-lg font-bold">Remise de l'article</h2>
              <div className="mt-4 space-y-5">
                <div>
                  <Label className="mb-2 block text-[13px] font-semibold">Mode de remise</Label>
                  <div className="space-y-2.5" role="radiogroup" aria-label="Mode de remise">
                    <SelectableCard selected onSelect={() => {}} icon={Handshake} title="Remise en main propre" description="Gratuit · sur le campus" />
                    <SelectableCard selected={false} onSelect={() => {}} icon={Truck} title="Livraison" description="Bientôt disponible" disabled />
                  </div>
                </div>
                <Field label="Lieu de rendez-vous souhaité" htmlFor="co-meeting">
                  <Select value={meeting} onValueChange={setMeeting}><SelectTrigger id="co-meeting" className="h-11 bg-card"><SelectValue /></SelectTrigger><SelectContent>{meetingPoints.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select>
                </Field>
                <Field label="Message au vendeur (facultatif)" htmlFor="co-note"><Textarea id="co-note" className="min-h-20" maxLength={500} placeholder="Bonjour, je suis disponible en fin d'après-midi." value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">En continuant, l'article est réservé pour vous pendant 30 minutes le temps du paiement.</p>
              <div className="mt-4 grid grid-cols-[auto_1fr] gap-2.5"><Button size="lg" variant="outline" disabled={creating} onClick={() => setStage("recap")}><ArrowLeft /> Retour</Button><Button size="lg" disabled={creating} onClick={() => void goPayment()}>{creating ? "Réservation…" : "Continuer vers le paiement"} {!creating && <ArrowRight />}</Button></div>
            </div>
          )}

          {stage === "paiement" && order && (
            <PaymentFlow
              amount={total} state={payment.state} onStateChange={payment.setState} method={method} onMethodChange={setMethod} country={CAMEROON} phone={phone} onPhoneChange={setPhone}
              continueLabel="Voir ma commande" onContinue={() => { setStage("commande"); }} receipt={[["Commande", orderNumber]]} reference={orderNumber}
              onPay={() => void payment.pay(phone, method)} payBusy={payment.busy} payError={payment.error} onCheck={() => void payment.check()} onCancel={payment.reset}
            />
          )}

          {cancelable && <button onClick={() => setCancelOpen(true)} className="mt-6 text-sm font-semibold text-muted-foreground underline underline-offset-4 hover:text-destructive">Annuler la commande</button>}
        </div>
        <div className="lg:sticky lg:top-24 lg:self-start">{summary}</div>
      </div>

      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} destructive title="Annuler la commande ?" description="Votre réservation sera libérée. Aucun montant n'a été débité." confirmLabel="Annuler la commande" cancelLabel="Continuer l'achat" onConfirm={cancelOrder} />
    </div>
  );
}
