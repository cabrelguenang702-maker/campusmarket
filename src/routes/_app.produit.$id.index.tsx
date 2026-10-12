import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Bell, Cart, Clock, Coin, Eye, Flag, Handshake, Heart, MessageCircle, Search, Share, ShieldCheck } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { LocationBadge, Pill, RatingStars, StockIndicator } from "@/components/cm/badges";
import { FavoriteButton, Price, ProductCard, SellerCard } from "@/components/cm/commerce";
import { InlineAlert, StateScreen } from "@/components/cm/feedback";
import { NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { ReportDialog } from "@/components/cm/ReportDialog";
import { ProductGallery } from "@/components/marketplace/ProductGallery";
import { OfferDialog } from "@/components/marketplace/OfferDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { categoryOf, formatFcfa, type Product } from "@/lib/domain";
import { useProduct, useSeller, useSimilarListings, recordProductView } from "@/lib/api/products";
import { acceptCounterOffer, findOrCreateConversation, useMyOpenOffer, useProductAlert, withdrawOffer } from "@/lib/api/engagement";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";
import { useFavorites } from "@/lib/favorites";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/produit/$id/")({
  head: () => ({ meta: [{ title: "Annonce — CampusMarket" }] }),
  component: ProductPage,
});

/** État d'affichage de la fiche, déduit du statut réel de l'annonce et de son stock. */
type DetailState = "disponible" | "reserve" | "vendu" | "expire" | "indisponible" | "revue";

function derivedState(p: Product): DetailState {
  if (p.status === "pending_review" || p.status === "draft") return "revue";
  if (p.status === "removed") return "indisponible";
  if (p.stock === "sold") return "vendu";
  if (p.stock === "reserved") return "reserve";
  if (p.stock === "expired") return "expire";
  return "disponible";
}

function DetailSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-2" aria-busy>
      <div><div className="aspect-[4/3] animate-pulse rounded-xl bg-foreground/10" /><div className="mt-3 grid grid-cols-4 gap-2.5">{[0, 1, 2, 3].map((i) => <div key={i} className="aspect-square animate-pulse rounded-lg bg-foreground/10" />)}</div></div>
      <div className="space-y-4"><div className="h-6 w-1/3 animate-pulse rounded bg-foreground/10" /><div className="h-9 w-3/4 animate-pulse rounded bg-foreground/10" /><div className="h-10 w-1/2 animate-pulse rounded bg-foreground/10" /><div className="h-24 animate-pulse rounded-lg bg-foreground/10" /><div className="h-12 animate-pulse rounded-lg bg-foreground/10" /></div>
    </div>
  );
}

function ProductPage() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const userId = session?.user.id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const favorites = useFavorites();
  const [offerOpen, setOfferOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const productQuery = useProduct(id);
  const product = productQuery.data ?? undefined;
  const sellerQuery = useSeller(product?.sellerId);
  const similarQuery = useSimilarListings(product);
  const myOffer = useMyOpenOffer(userId, id);
  const alert = useProductAlert(userId, id);

  const isOwner = !!product && product.sellerId === userId;

  useEffect(() => {
    if (!product || isOwner || product.status !== "published" || !userId) return;
    // Une vue de plus (sans effet pour le vendeur). Un échec ici ne doit jamais gêner la lecture.
    recordProductView(product.id).catch(() => undefined);
  }, [product?.id, product?.status, isOwner, userId]);

  const contact = useMutation({
    mutationFn: async () => {
      if (!userId || !product) throw new Error("not-authenticated");
      return findOrCreateConversation(userId, product.sellerId, product.id);
    },
    onSuccess: (conversationId) => { void navigate({ to: `/messages/${conversationId}` as "/" }); },
    onError: (error) => toast.error(friendlyError(error, "Impossible d'ouvrir la conversation. Réessayez.")),
  });

  const acceptOffer = useMutation({
    mutationFn: (offerId: string) => acceptCounterOffer(offerId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-offer", id] });
      void navigate({ to: `/produit/${id}/acheter` as "/" });
    },
    onError: (error) => toast.error(friendlyError(error, "Impossible d'accepter la contre-proposition.")),
  });

  const dropOffer = useMutation({
    mutationFn: (offerId: string) => withdrawOffer(offerId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["my-offer", id] }); toast.success("Offre retirée"); },
    onError: (error) => toast.error(friendlyError(error, "Impossible de retirer l'offre.")),
  });

  const toggleAlert = () => {
    const next = !alert.active;
    alert.toggle.mutate(next, {
      onSuccess: () => toast.success(next ? "Alerte activée" : "Alerte désactivée", { description: next ? "Nous vous prévenons si l'article redevient disponible." : undefined }),
      onError: (error) => toast.error(friendlyError(error, "Impossible de modifier l'alerte.")),
    });
  };

  if (productQuery.isLoading) {
    return (
      <div>
        <PageHeader title="Annonce" breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Marketplace", to: "/marketplace" }, { label: "Annonce" }]} />
        <DetailSkeleton />
      </div>
    );
  }

  if (productQuery.isError) {
    return (
      <div>
        <PageHeader title="Annonce" breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Marketplace", to: "/marketplace" }, { label: "Annonce" }]} />
        {isNetworkError(productQuery.error) ? <NetworkErrorScreen compact onRetry={() => void productQuery.refetch()} /> : <ServerErrorScreen compact onRetry={() => void productQuery.refetch()} />}
      </div>
    );
  }

  if (!product) {
    return (
      <div>
        <PageHeader title="Annonce" breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Marketplace", to: "/marketplace" }, { label: "Annonce" }]} />
        <StateScreen icon={Search} tone="neutral" title="Annonce introuvable" description="Cette annonce a été supprimée ou n'existe pas. Elle a peut-être été retirée par son vendeur." actions={<Button asChild size="lg"><AppLink to="/marketplace">Retour à la marketplace</AppLink></Button>} />
      </div>
    );
  }

  const seller = sellerQuery.data ?? undefined;
  const category = categoryOf(product.category);
  const similar = (similarQuery.data ?? []).filter((p) => p.stock === "available" || p.stock === "low").slice(0, 3);
  const state = derivedState(product);
  const offer = myOffer.data ?? null;
  const counter = offer?.status === "countered" && offer.counterAmount ? offer : null;
  const accepted = offer?.status === "accepted" ? offer : null;
  const pendingOffer = offer?.status === "pending" ? offer : null;
  const closed = state === "vendu" || state === "expire" || state === "indisponible";
  const canBuy = (state === "disponible") && !isOwner;
  const unitPrice = counter?.counterAmount ?? accepted?.amount ?? product.price;

  const share = () => { void navigator.clipboard?.writeText(window.location.href); toast.success("Lien copié", { description: "Partagez cette annonce avec vos amis." }); };
  const writeToSeller = () => contact.mutate();

  return (
    <div className="pb-24 lg:pb-0">
      <PageHeader breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Marketplace", to: "/marketplace" }, { label: category.name, to: `/marketplace?categorie=${product.category}` }, { label: product.name }]} title="" className="mb-4 [&_h1]:hidden" />

      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <ProductGallery product={product} dimmed={closed} />

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="neutral">{product.condition}</Pill>
            <Pill tone="neutral">{category.name}</Pill>
            {product.negotiable && <Pill tone="primary" icon={Handshake}>Prix négociable</Pill>}
          </div>
          <h1 className="mt-3 font-display text-2xl font-bold leading-tight sm:text-3xl">{product.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <LocationBadge campus={product.campus} city={product.city} />
            <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{product.posted}</span>
            <span className="inline-flex items-center gap-1"><Eye className="size-3.5" />{product.views} vues</span>
            <span className="inline-flex items-center gap-1"><Heart className="size-3.5" />{product.favorites}</span>
          </div>

          <div className="mt-5">
            {counter ? <Price value={unitPrice} oldPrice={product.price} size="lg" /> : <Price value={product.price} oldPrice={product.oldPrice} size="lg" />}
            <div className="mt-2 flex items-center gap-4"><RatingStars value={product.rating} reviews={product.reviews} size="md" /><StockIndicator stock={product.stock} /></div>
          </div>

          {/* Bandeaux d'état */}
          <div className="mt-5 space-y-3" aria-live="polite">
            {isOwner && state === "revue" && <InlineAlert tone="warning" title="Annonce en cours de revue">Votre annonce sera visible par les acheteurs dès qu'un modérateur l'aura validée.</InlineAlert>}
            {isOwner && state !== "revue" && <InlineAlert tone="neutral" title="Ceci est votre annonce">Vous la voyez comme les acheteurs. Gérez-la depuis « Mes annonces ».</InlineAlert>}
            {!isOwner && counter && (
              <InlineAlert tone="primary" title={`Le vendeur vous propose ${formatFcfa(counter.counterAmount ?? 0)}`}>
                Contre-proposition suite à votre offre de {formatFcfa(counter.amount)}.
                <span className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={acceptOffer.isPending} onClick={() => acceptOffer.mutate(counter.id)}>{acceptOffer.isPending ? "Un instant…" : "Accepter et acheter"}</Button>
                  <Button size="sm" variant="ghost" disabled={dropOffer.isPending} onClick={() => dropOffer.mutate(counter.id)}>Refuser</Button>
                </span>
              </InlineAlert>
            )}
            {!isOwner && accepted && (
              <InlineAlert tone="success" title={`Offre acceptée : ${formatFcfa(accepted.amount)}`}>
                Le vendeur a accepté votre offre. Finalisez l'achat pour la réserver.
                <span className="mt-3 flex flex-wrap gap-2"><Button size="sm" asChild><AppLink to={`/produit/${product.id}/acheter`}>Finaliser l'achat</AppLink></Button></span>
              </InlineAlert>
            )}
            {!isOwner && pendingOffer && (
              <InlineAlert tone="neutral" title={`Offre envoyée : ${formatFcfa(pendingOffer.amount)}`}>
                En attente de la réponse du vendeur.
                <span className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={dropOffer.isPending} onClick={() => dropOffer.mutate(pendingOffer.id)}>Retirer mon offre</Button></span>
              </InlineAlert>
            )}
            {state === "reserve" && <InlineAlert tone="warning" title="Article réservé">Un acheteur a déjà réservé cet article. Activez une alerte pour être prévenu s'il redevient disponible.</InlineAlert>}
            {state === "vendu" && <InlineAlert tone="neutral" title="Cet article a été vendu">Il n'est plus disponible à l'achat. Découvrez des articles similaires ci-dessous.</InlineAlert>}
            {state === "expire" && <InlineAlert tone="neutral" title="Annonce expirée">Cette annonce n'est plus active. Vous pouvez demander au vendeur s'il dispose encore de l'article.</InlineAlert>}
            {state === "indisponible" && <InlineAlert tone="danger" title="Article indisponible">Cette annonce a été retirée par le vendeur ou suspendue par la modération.</InlineAlert>}
          </div>

          {/* Actions */}
          <div className="mt-6 space-y-2.5">
            {canBuy && (
              <>
                <Button asChild size="lg" className="w-full"><AppLink to={`/produit/${product.id}/acheter`}><Cart /> Acheter maintenant</AppLink></Button>
                <div className="grid grid-cols-2 gap-2.5">
                  {product.negotiable && !offer ? <Button size="lg" variant="outline" onClick={() => setOfferOpen(true)}><Coin /> Faire une offre</Button> : <Button size="lg" variant="outline" disabled><Coin /> {product.negotiable ? "Offre en cours" : "Prix ferme"}</Button>}
                  <Button size="lg" variant="outline" disabled={contact.isPending} onClick={writeToSeller}><MessageCircle /> Écrire</Button>
                </div>
              </>
            )}
            {state === "reserve" && !isOwner && (
              <Button size="lg" className="w-full" disabled={alert.loading || alert.toggle.isPending} variant={alert.active ? "outline" : "default"} onClick={toggleAlert}><Bell /> {alert.active ? "Alerte activée — désactiver" : "Me prévenir si disponible"}</Button>
            )}
            {(state === "vendu" || state === "indisponible") && <Button asChild size="lg" className="w-full"><AppLink to="/marketplace" search={{ categorie: product.category }}>Voir des articles similaires</AppLink></Button>}
            {state === "expire" && !isOwner && <Button size="lg" className="w-full" disabled={contact.isPending} onClick={writeToSeller}><MessageCircle /> Demander au vendeur</Button>}
            <div className="flex items-center justify-between rounded-lg border border-border bg-card px-2 py-1">
              <FavoriteButton label="favoris" className="size-10" active={favorites.has(product.id)} onChange={() => favorites.toggle(product.id)} />
              <Button variant="ghost" size="sm" onClick={share}><Share /> Partager</Button>
              {!isOwner && <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setReportOpen(true)}><Flag /> Signaler</Button>}
            </div>
          </div>

          {seller && <div className="mt-5"><SellerCard seller={seller} /></div>}
        </div>
      </div>

      {/* Détails */}
      <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-display text-lg font-bold">Description</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-7 text-muted-foreground">{product.description}</p>
          </section>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-display text-lg font-bold">Caractéristiques</h2>
            <dl className="mt-3 divide-y divide-border text-sm">
              {[["État", product.condition], ...product.specs, ["Quantité disponible", String(product.quantity)]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>
              ))}
            </dl>
          </section>
        </div>
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-display text-lg font-bold">Remise de l'article</h2>
            <ul className="mt-3 space-y-3 text-sm text-muted-foreground">
              <li className="flex gap-3"><LocationBadge campus={product.campus} city={product.city} className="text-sm" /></li>
              <li>Remise en main propre sur le campus, dans un lieu public.</li>
              <li>Paiement par Mobile Money depuis la plateforme.</li>
            </ul>
          </section>
          <section className="rounded-xl border border-success/30 bg-success/5 p-5">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold"><ShieldCheck className="size-5 text-success" /> Conseils de sécurité</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>Rencontrez le vendeur sur le campus, en journée.</li>
              <li>Vérifiez l'article avant de confirmer la réception.</li>
              <li>Ne payez jamais en dehors de CampusMarket.</li>
              <li>Signalez toute annonce suspecte.</li>
            </ul>
          </section>
        </div>
      </div>

      {similar.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex items-end justify-between"><h2 className="font-display text-xl font-bold">Articles similaires</h2><Button asChild variant="ghost" size="sm"><AppLink to="/marketplace" search={{ categorie: product.category }}>Voir tout</AppLink></Button></div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{similar.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        </section>
      )}

      {/* Barre d'achat mobile */}
      {canBuy && (
        <div className={cn("fixed inset-x-0 z-20 flex items-center gap-3 border-t border-border bg-background/95 px-4 py-2.5 backdrop-blur lg:hidden", "bottom-[calc(3.9rem+env(safe-area-inset-bottom,0px))]")}>
          <div className="min-w-0 flex-1"><p className="truncate text-[11px] text-muted-foreground">{product.name}</p><p className="font-display text-lg font-bold text-primary">{formatFcfa(unitPrice)}</p></div>
          <Button asChild size="lg"><AppLink to={`/produit/${product.id}/acheter`}>Acheter</AppLink></Button>
        </div>
      )}

      <OfferDialog product={product} open={offerOpen} onOpenChange={setOfferOpen} />
      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} targetType="product" targetId={product.id} subject={product.name} />
    </div>
  );
}
