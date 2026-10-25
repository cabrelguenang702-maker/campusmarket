import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertTriangle, Archive, CalendarDays, Check, MessageCircle, MoreHorizontal, Pencil, Plus, RefreshCw, Star, Store, Ticket, Trash, Users, X } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { ProductCard, ProductCardSkeleton, ProductVisual } from "@/components/cm/commerce";
import { ConfirmDialog } from "@/components/cm/feedback";
import { EmptyScreen, NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { categoryOf, formatFcfa, timeLeft, type Product } from "@/lib/domain";
import { useMyOrders, useOrderActions, type Order, type OrderStatus } from "@/lib/api/orders";
import { DisputeDialog, OrderTimeline } from "@/components/orders/OrderExtras";
import { findOrCreateConversation, useOfferResponses, useReceivedOffers, type ReceivedOffer } from "@/lib/api/engagement";
import { deleteOwnListing, setOwnListingStatus, useSellerListings } from "@/lib/api/products";
import { useMyWanted, useWantedMutations } from "@/lib/api/wanted";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useMyEvents } from "@/lib/api/events";
import { useMySpaces } from "@/lib/api/spaces";
import { memberLabel, roleLabel, type SpaceKind } from "@/lib/spaces-model";

export type ProfileTab = "annonces" | "achats" | "ventes" | "demandes" | "groupes" | "communautes" | "evenements";

export const profileTabs: { id: ProfileTab; label: string }[] = [
  { id: "annonces", label: "Mes annonces" },
  { id: "achats", label: "Mes achats" },
  { id: "ventes", label: "Mes ventes" },
  { id: "demandes", label: "Mes demandes" },
  { id: "groupes", label: "Mes groupes" },
  { id: "communautes", label: "Mes communautés" },
  { id: "evenements", label: "Mes événements" },
];

function OrderStatusPill({ status, kind }: { status: OrderStatus; kind: "achat" | "vente" }) {
  switch (status) {
    case "pending_payment": return <Pill tone="warning">En attente de paiement</Pill>;
    case "paid": return <Pill tone="info">{kind === "vente" ? "Payée · à remettre" : "Payée · remise à venir"}</Pill>;
    case "confirmed": return <Pill tone="primary">Remise confirmée</Pill>;
    case "completed": return <Pill tone="success" icon={Check}>Terminée</Pill>;
    case "disputed": return <Pill tone="danger">Litige en cours</Pill>;
    default: return <Pill tone="neutral">Annulée</Pill>;
  }
}

function ReviewDialog({ order, open, onOpenChange }: { order: Order; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { review } = useOrderActions();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const send = () => review.mutate({ orderId: order.id, sellerId: order.sellerId, reviewerId: order.buyerId, rating, body }, {
    onSuccess: () => { toast.success("Merci pour votre avis"); onOpenChange(false); },
    onError: (e) => toast.error(friendlyError(e, "Votre avis n'a pas pu être envoyé.")),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-display">Noter {order.counterpart}</DialogTitle><DialogDescription>{order.productName}</DialogDescription></DialogHeader>
        <div className="flex justify-center gap-1.5" role="radiogroup" aria-label="Note de 1 à 5">
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} étoile${n > 1 ? "s" : ""}`} onClick={() => setRating(n)} className="rounded p-1"><Star className={cn("size-8", n <= rating ? "fill-warning text-warning" : "text-muted-foreground/40")} /></button>)}
        </div>
        <Textarea maxLength={1000} placeholder="Racontez votre expérience (facultatif)" value={body} onChange={(e) => setBody(e.target.value)} />
        <DialogFooter className="gap-2 sm:gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Plus tard</Button><Button disabled={rating === 0 || review.isPending} onClick={send}>{review.isPending ? "Envoi…" : "Publier l'avis"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderRow({ order: o, kind, userId }: { order: Order; kind: "achat" | "vente"; userId: string }) {
  const navigate = useNavigate();
  const actions = useOrderActions();
  const category = categoryOf(o.productCategory);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirm, setConfirm] = useState<"dispute" | "cancel" | null>(null);
  const [details, setDetails] = useState(false);

  const contact = async () => {
    try {
      const id = await findOrCreateConversation(userId, kind === "achat" ? o.sellerId : o.buyerId, o.productId);
      void navigate({ to: `/messages/${id}` as "/" });
    } catch (e) { toast.error(friendlyError(e, "Impossible d'ouvrir la conversation.")); }
  };
  const run = (m: { mutate: (id: string, opts: { onSuccess: () => void; onError: (e: unknown) => void }) => void }, okMessage: string, description?: string) =>
    m.mutate(o.id, { onSuccess: () => toast.success(okMessage, description ? { description } : undefined), onError: (e) => toast.error(friendlyError(e, "Action impossible pour le moment.")) });
  const busy = actions.receive.isPending || actions.handover.isPending || actions.cancel.isPending;

  return (
    <li className="flex gap-3 rounded-xl border border-border bg-card p-3.5 sm:p-4">
      <ProductVisual product={{ icon: category.icon, tone: category.tone, name: o.productName }} className="size-16 shrink-0 rounded-lg sm:size-20 [&_svg]:size-8" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2"><AppLink to={`/produit/${o.productId}`} className="truncate text-sm font-semibold hover:text-primary">{o.productName}{o.quantity > 1 ? ` × ${o.quantity}` : ""}</AppLink><OrderStatusPill status={o.status} kind={kind} /></div>
        <p className="mt-0.5 text-xs text-muted-foreground">{kind === "achat" ? "Vendeur" : "Acheteur"} : {o.counterpart} · {o.date}</p>
        <p className="text-[11px] text-muted-foreground">CM-{o.id.slice(0, 8).toUpperCase()}{o.meetingPoint ? ` · ${o.meetingPoint}` : ""}</p>
        {kind === "vente" && o.note && <p className="mt-1 text-xs italic text-muted-foreground">« {o.note} »</p>}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-display font-bold text-primary">{formatFcfa(o.total)}</span>
          <span className="flex flex-wrap gap-2">
            {kind === "achat" && o.status === "pending_payment" && <Button asChild size="sm"><AppLink to={`/produit/${o.productId}/acheter`}>Payer</AppLink></Button>}
            {kind === "achat" && o.status === "confirmed" && <Button size="sm" disabled={busy} onClick={() => run(actions.receive, "Réception confirmée", "Merci ! Pensez à noter le vendeur.")}>Confirmer la réception</Button>}
            {kind === "achat" && o.status === "completed" && !o.reviewed && <Button size="sm" variant="soft" onClick={() => setReviewOpen(true)}><Star /> Noter le vendeur</Button>}
            {kind === "vente" && o.status === "paid" && <Button size="sm" disabled={busy} onClick={() => run(actions.handover, "Remise confirmée", "L'acheteur peut maintenant confirmer la réception.")}>Marquer comme remis</Button>}
            {o.status !== "cancelled" && <Button size="sm" variant="outline" onClick={() => void contact()}><MessageCircle /> Contacter</Button>}
            <Button size="sm" variant="ghost" aria-expanded={details} onClick={() => setDetails((v) => !v)}>{details ? "Masquer le suivi" : "Suivi"}</Button>
            {kind === "achat" && (o.status === "pending_payment" || o.status === "paid" || o.status === "confirmed") && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="sm" variant="outline" aria-label="Plus d'actions" disabled={busy}><MoreHorizontal /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(o.status === "paid" || o.status === "confirmed") && <DropdownMenuItem className="cursor-pointer" onClick={() => setConfirm("dispute")}><AlertTriangle /> Signaler un problème</DropdownMenuItem>}
                  {(o.status === "pending_payment" || o.status === "paid") && <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={() => setConfirm("cancel")}><X /> Annuler la commande</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </span>
        </div>
        {details && <OrderTimeline order={o} kind={kind} showReceipt={["paid", "confirmed", "completed", "disputed"].includes(o.status)} />}
      </div>
      {kind === "achat" && <ReviewDialog order={o} open={reviewOpen} onOpenChange={setReviewOpen} />}
      {kind === "achat" && <DisputeDialog order={o} open={confirm === "dispute"} onOpenChange={(v) => !v && setConfirm(null)} />}
      <ConfirmDialog open={confirm === "cancel"} onOpenChange={(v) => !v && setConfirm(null)} destructive title="Annuler cette commande ?" description={o.status === "paid" ? "Votre paiement a déjà été reçu : l'annulation sera traitée par notre support, qui organisera le remboursement." : "Votre réservation sera libérée. Aucun montant n'a été débité."} confirmLabel="Annuler la commande" cancelLabel="Garder la commande" onConfirm={() => run(actions.cancel, "Commande annulée")} />
    </li>
  );
}

function ReceivedOffers({ sellerId }: { sellerId: string }) {
  const q = useReceivedOffers(sellerId);
  const { accept, reject, counter } = useOfferResponses();
  const [target, setTarget] = useState<ReceivedOffer | null>(null);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const offers = q.data ?? [];
  if (offers.length === 0) return null;

  const fail = (e: unknown) => toast.error(friendlyError(e, "Action impossible pour le moment."));
  const value = Number(amount.replace(/\D/g, ""));

  return (
    <section className="mb-6" aria-label="Offres à traiter">
      <h3 className="mb-3 font-display text-base font-bold">Offres à traiter ({offers.length})</h3>
      <ul className="space-y-3">
        {offers.map((o) => (
          <li key={o.id} className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><AppLink to={`/produit/${o.productId}`} className="truncate text-sm font-semibold hover:text-primary">{o.productName}</AppLink><Pill tone={o.status === "countered" ? "info" : "warning"}>{o.status === "countered" ? "Contre-offre envoyée" : "En attente"}</Pill></div>
            <p className="mt-1 text-xs text-muted-foreground">{o.buyer} propose <span className="font-semibold text-foreground">{formatFcfa(o.amount)}</span> pour {formatFcfa(o.price)}{o.status === "countered" && o.counterAmount ? ` · vous avez répondu ${formatFcfa(o.counterAmount)}` : ""}</p>
            {o.message && <p className="mt-1 text-xs italic text-muted-foreground">« {o.message} »</p>}
            {o.status === "pending" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" disabled={accept.isPending} onClick={() => accept.mutate(o.id, { onSuccess: () => toast.success("Offre acceptée", { description: "L'acheteur peut maintenant payer." }), onError: fail })}>Accepter</Button>
                <Button size="sm" variant="outline" onClick={() => { setTarget(o); setAmount(String(Math.round((o.amount + o.price) / 2))); setMessage(""); }}>Contre-proposer</Button>
                <Button size="sm" variant="ghost" disabled={reject.isPending} onClick={() => reject.mutate(o.id, { onSuccess: () => toast("Offre refusée"), onError: fail })}>Refuser</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display">Contre-proposition</DialogTitle><DialogDescription>{target?.productName} · offre de {target ? formatFcfa(target.amount) : ""}</DialogDescription></DialogHeader>
          <input aria-label="Montant proposé en FCFA" inputMode="numeric" value={value ? value.toLocaleString("fr-FR") : ""} onChange={(e) => setAmount(e.target.value)} className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm" />
          {target && value > 0 && (value <= target.amount || value > target.price) && <p role="alert" className="text-xs text-destructive">Proposez un montant supérieur à l'offre ({formatFcfa(target.amount)}) et au plus égal au prix de l'annonce ({formatFcfa(target.price)}).</p>}
          <Textarea maxLength={500} placeholder="Message (facultatif)" value={message} onChange={(e) => setMessage(e.target.value)} />
          <DialogFooter className="gap-2 sm:gap-2"><Button variant="outline" onClick={() => setTarget(null)}>Annuler</Button><Button disabled={!target || !value || value <= target.amount || value > target.price || counter.isPending} onClick={() => { if (target) counter.mutate({ id: target.id, amount: value, message }, { onSuccess: () => { toast.success("Contre-proposition envoyée"); setTarget(null); }, onError: fail }); }}>Envoyer</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function OrdersTab({ kind }: { kind: "achat" | "vente" }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const q = useMyOrders(userId, kind === "achat" ? "buyer" : "seller");
  if (q.isLoading) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div>;
  if (q.isError) return isNetworkError(q.error) ? <NetworkErrorScreen compact onRetry={() => void q.refetch()} /> : <ServerErrorScreen compact onRetry={() => void q.refetch()} />;
  const orders = q.data ?? [];
  if (!userId) return <ProfileEmpty tab={kind === "achat" ? "achats" : "ventes"} />;
  return (
    <div>
      {kind === "vente" && <p className="mb-3 text-sm"><AppLink to="/profil/finances" className="font-semibold text-primary hover:underline">Voir mon tableau financier</AppLink><span className="mx-2 text-muted-foreground">·</span><AppLink to="/profil/gains" className="font-semibold text-primary hover:underline">Mes gains et versements</AppLink><span className="mx-2 text-muted-foreground">·</span><AppLink to="/boutique-premium" className="font-semibold text-primary hover:underline">Boutique Premium</AppLink></p>}
      {kind === "vente" && <ReceivedOffers sellerId={userId} />}
      {orders.length === 0 ? (kind === "vente" ? <ProfileEmpty tab="ventes" /> : <ProfileEmpty tab="achats" />) : <ul className="space-y-3">{orders.map((o) => <OrderRow key={o.id} order={o} kind={kind} userId={userId} />)}</ul>}
    </div>
  );
}

type ListingFilter = "toutes" | "en-ligne" | "en-revue" | "brouillons" | "terminees";
const listingFilters: [ListingFilter, string][] = [["toutes", "Toutes"], ["en-ligne", "En ligne"], ["en-revue", "En revue"], ["brouillons", "Brouillons"], ["terminees", "Terminées"]];

function filterOf(p: Product): ListingFilter {
  if (p.status === "published") return "en-ligne";
  if (p.status === "pending_review") return "en-revue";
  if (p.status === "draft") return "brouillons";
  return "terminees";
}

function ListingStatusPill({ p }: { p: Product }) {
  switch (p.status) {
    case "published": return <Pill tone="success">En ligne{p.expiresAt ? ` · expire dans ${timeLeft(p.expiresAt)}` : ""}</Pill>;
    case "pending_review": return <Pill tone="warning">En cours de revue</Pill>;
    case "draft": return <Pill tone="neutral">Brouillon</Pill>;
    case "sold": return <Pill tone="neutral">Vendue</Pill>;
    case "archived": return <Pill tone="neutral">Retirée ou expirée</Pill>;
    default: return <Pill tone="danger">Retirée par la modération</Pill>;
  }
}

function ListingsTab() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useSellerListings(userId, false);
  const [filter, setFilter] = useState<ListingFilter>("toutes");
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  const [confirmEdit, setConfirmEdit] = useState<Product | null>(null);

  const refresh = (id: string) => {
    void qc.invalidateQueries({ queryKey: ["seller-listings"] });
    void qc.invalidateQueries({ queryKey: ["listings"] });
    void qc.invalidateQueries({ queryKey: ["product", id] });
    void qc.invalidateQueries({ queryKey: ["recent-listings"] });
  };
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "archived" | "sold" | "draft" | "pending_review" }) => setOwnListingStatus(id, status),
    onSuccess: (_d, v) => { refresh(v.id); toast.success(v.status === "sold" ? "Annonce marquée comme vendue" : v.status === "archived" ? "Annonce retirée de la vente" : v.status === "pending_review" ? "Annonce renvoyée en validation" : "Annonce repassée en brouillon"); },
    onError: (e) => toast.error(friendlyError(e, "Impossible de modifier l'annonce.")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteOwnListing(id),
    onSuccess: (_d, id) => { refresh(id); toast("Annonce supprimée"); },
    onError: (e) => toast.error(friendlyError(e, "Impossible de supprimer l'annonce.")),
  });

  if (q.isLoading) return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <ProductCardSkeleton key={i} />)}</div>;
  if (q.isError) return isNetworkError(q.error) ? <NetworkErrorScreen compact onRetry={() => void q.refetch()} /> : <ServerErrorScreen compact onRetry={() => void q.refetch()} />;

  const all = q.data ?? [];
  if (all.length === 0) return <ProfileEmpty tab="annonces" />;
  const list = all.filter((p) => filter === "toutes" || filterOf(p) === filter);
  const count = (f: ListingFilter) => (f === "toutes" ? all.length : all.filter((p) => filterOf(p) === f).length);
  const busy = setStatus.isPending || remove.isPending;

  return (
    <div>
      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrer mes annonces">
        {listingFilters.map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)} className={cn("shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition", filter === id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{label} ({count(id)})</button>)}
      </div>
      {list.length === 0 ? <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Aucune annonce dans cette sélection.</p> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const live = p.status === "published";
            const resubmittable = p.status === "archived" || p.status === "sold";
            const moderated = p.status === "removed";
            return (
              <div key={p.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2"><ListingStatusPill p={p} /></div>
                <ProductCard product={p} />
                {!moderated && (
                  <div className="flex gap-2">
                    {live ? (
                      <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => setConfirmEdit(p)}><Pencil /> Modifier</Button>
                    ) : (
                      <Button asChild size="sm" variant="outline" className="flex-1"><AppLink to="/publier" search={{ edit: p.id }}>{p.status === "draft" ? <><Pencil /> Continuer</> : <><Pencil /> Modifier</>}</AppLink></Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="sm" variant="outline" aria-label={`Actions pour ${p.name}`} disabled={busy}><MoreHorizontal /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {live && <DropdownMenuItem className="cursor-pointer" onClick={() => setStatus.mutate({ id: p.id, status: "sold" })}><Check /> Marquer comme vendue</DropdownMenuItem>}
                        {live && <DropdownMenuItem className="cursor-pointer" onClick={() => setStatus.mutate({ id: p.id, status: "archived" })}><Archive /> Retirer de la vente</DropdownMenuItem>}
                        {resubmittable && <DropdownMenuItem className="cursor-pointer" onClick={() => setStatus.mutate({ id: p.id, status: "pending_review" })}><RefreshCw /> Remettre en vente</DropdownMenuItem>}
                        {p.status === "pending_review" && <DropdownMenuItem className="cursor-pointer" onClick={() => setStatus.mutate({ id: p.id, status: "draft" })}><Archive /> Repasser en brouillon</DropdownMenuItem>}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={() => setConfirmDelete(p)}><Trash /> Supprimer</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
                {moderated && <p className="text-xs text-muted-foreground">Cette annonce a été retirée par la modération. Contactez le support pour en savoir plus.</p>}
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)} destructive title="Supprimer cette annonce ?" description="Elle ne sera plus visible. Les conversations et commandes liées sont conservées." confirmLabel="Supprimer" onConfirm={() => { if (confirmDelete) remove.mutate(confirmDelete.id); }} />
      <ConfirmDialog open={confirmEdit !== null} onOpenChange={(o) => !o && setConfirmEdit(null)} title="Modifier cette annonce en ligne ?" description="Après modification, l'annonce repasse en validation et n'est plus visible des acheteurs tant qu'elle n'est pas revalidée." confirmLabel="Modifier" onConfirm={() => { if (confirmEdit) void navigate({ to: "/publier", search: { edit: confirmEdit.id } }); }} />
    </div>
  );
}

function ProfileEmpty({ tab }: { tab: ProfileTab }) {
  const [title, description, cta, to] = emptyMessages[tab];
  return <EmptyScreen compact title={title} description={description} actions={<Button asChild><AppLink to={to}><Plus /> {cta}</AppLink></Button>} />;
}

function RequestsTab() {
  const { session } = useAuth();
  const q = useMyWanted(session?.user.id);
  const { setStatus } = useWantedMutations();
  if (q.isLoading) return <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />)}</div>;
  if (q.isError) return isNetworkError(q.error) ? <NetworkErrorScreen compact onRetry={() => void q.refetch()} /> : <ServerErrorScreen compact onRetry={() => void q.refetch()} />;
  const list = q.data ?? [];
  if (list.length === 0) return <ProfileEmpty tab="demandes" />;
  return (
    <ul className="space-y-3">
      {list.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{r.title}</p><p className="mt-0.5 text-xs text-muted-foreground">Budget {formatFcfa(r.budget)} · {r.posted} · {r.responses} réponse{r.responses > 1 ? "s" : ""}</p></div>
          <Pill tone={r.status === "open" ? "success" : "neutral"}>{r.status === "open" ? "Ouverte" : "Pourvue"}</Pill>
          <span className="flex gap-2">
            {r.status === "open" && <Button size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: "fulfilled" }, { onSuccess: () => toast.success("Demande marquée comme pourvue"), onError: (e) => toast.error(friendlyError(e, "Impossible de modifier la demande.")) })}>Marquer pourvue</Button>}
            <Button asChild size="sm" variant="outline"><AppLink to="/je-recherche">Voir</AppLink></Button>
          </span>
        </li>
      ))}
    </ul>
  );
}

const emptyMessages: Record<ProfileTab, [string, string, string, string]> = {
  annonces: ["Aucune annonce", "Publiez votre premier article et touchez tout le campus.", "Publier une annonce", "/publier"],
  achats: ["Aucun achat", "Vos commandes apparaîtront ici après votre premier achat.", "Découvrir la marketplace", "/marketplace"],
  ventes: ["Aucune vente", "Vos ventes apparaîtront ici dès qu'un article est acheté.", "Publier une annonce", "/publier"],
  demandes: ["Aucune demande", "Publiez ce que vous cherchez, les vendeurs vous répondent.", "Créer une demande", "/je-recherche"],
  groupes: ["Aucun groupe", "Rejoignez un groupe pour échanger avec votre promotion.", "Explorer les groupes", "/groupes"],
  communautes: ["Aucune communauté", "Rejoignez des communautés qui partagent vos centres d'intérêt.", "Explorer les communautés", "/communautes"],
  evenements: ["Aucun événement", "Vos billets et événements à venir s'afficheront ici.", "Voir les événements", "/evenements"],
};

/** Mes événements : ceux pour lesquels j'ai un billet valide ou déjà utilisé. */
function EventsTab() {
  const { session } = useAuth();
  const query = useMyEvents(session?.user.id);
  if (query.isPending) return <ul className="space-y-3" aria-busy>{[0, 1].map((i) => <li key={i} className="h-20 animate-pulse rounded-xl bg-foreground/10" />)}</ul>;
  if (query.isError) return isNetworkError(query.error) ? <NetworkErrorScreen compact onRetry={() => void query.refetch()} /> : <ServerErrorScreen compact onRetry={() => void query.refetch()} />;
  const list = query.data ?? [];
  if (list.length === 0) return <EmptyScreen compact title="Aucun événement" description="Les événements auxquels vous êtes inscrit apparaîtront ici." actions={<Button asChild><AppLink to="/evenements"><Plus /> Voir les événements</AppLink></Button>} />;
  return (
    <ul className="space-y-3">
      {list.map((e) => (
        <li key={e.id}><AppLink to={`/evenements/${e.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition hover:border-primary/40">
          <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-warning/20 text-[oklch(0.42_0.1_65)] dark:text-warning"><CalendarDays className="size-6" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{e.name}</span><span className="block text-xs text-muted-foreground">{e.dateLabel} · {e.place}</span></span>
          {e.status === "termine" ? <Pill tone="neutral">Terminé</Pill> : e.status === "annule" ? <Pill tone="danger">Annulé</Pill> : <Pill tone="success" icon={Ticket}>Billet prêt</Pill>}
        </AppLink></li>
      ))}
    </ul>
  );
}

/** Mes communautés ou mes groupes : ceux dont je suis membre, avec mon rôle. */
function SpacesTab({ kind }: { kind: SpaceKind }) {
  const { session } = useAuth();
  const query = useMySpaces(session?.user.id, kind);
  const tab = kind === "groupe" ? "groupes" : "communautes";
  if (query.isPending) return <ul className="grid gap-3 sm:grid-cols-2" aria-busy>{[0, 1].map((i) => <li key={i} className="h-20 animate-pulse rounded-xl bg-foreground/10" />)}</ul>;
  if (query.isError) return isNetworkError(query.error) ? <NetworkErrorScreen compact onRetry={() => void query.refetch()} /> : <ServerErrorScreen compact onRetry={() => void query.refetch()} />;
  const list = query.data ?? [];
  if (list.length === 0) {
    const [title, description, cta, to] = emptyMessages[tab];
    return <EmptyScreen compact title={title} description={description} actions={<Button asChild><AppLink to={to}><Plus /> {cta}</AppLink></Button>} />;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {list.map((g) => (
        <li key={g.id}><AppLink to={`/${tab}/${g.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition hover:border-primary/40">
          <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-accent text-primary">{kind === "groupe" ? <Users className="size-6" /> : <Store className="size-6" />}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{g.name}</span><span className="block text-xs text-muted-foreground">{memberLabel(g.memberCount)}</span></span>
          <Pill tone={g.role === "member" ? "neutral" : "primary"}>{roleLabel[g.role]}</Pill>
        </AppLink></li>
      ))}
    </ul>
  );
}

export function ProfileTabContent({ tab, empty }: { tab: ProfileTab; empty?: boolean }) {
  if (empty) {
    const [title, description, cta, to] = emptyMessages[tab];
    return <EmptyScreen compact title={title} description={description} actions={<Button asChild><AppLink to={to}><Plus /> {cta}</AppLink></Button>} />;
  }
  switch (tab) {
    case "annonces": return <ListingsTab />;
    case "achats": return <OrdersTab kind="achat" />;
    case "ventes": return <OrdersTab kind="vente" />;
    case "demandes": return <RequestsTab />;
    case "groupes": return <SpacesTab kind="groupe" />;
    case "communautes": return <SpacesTab kind="communaute" />;
    case "evenements": return <EventsTab />;
  }
}
