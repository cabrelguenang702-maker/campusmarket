import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BadgeCheck, Check, Flag, MessageCircle, Package, Search, Share, UserPlus } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { RatingStars, VerificationBadge } from "@/components/cm/badges";
import { Avatar, ProductCard, ProductCardSkeleton } from "@/components/cm/commerce";
import { EmptyScreen, NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { StateScreen } from "@/components/cm/feedback";
import { ReportDialog } from "@/components/cm/ReportDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { setFollowing, useIsFollowing, useSeller, useSellerListings, useSellerRatingDistribution, useSellerReviews } from "@/lib/api/products";
import { findOrCreateConversation } from "@/lib/api/engagement";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/boutique/$id")({
  head: () => ({ meta: [{ title: "Boutique — CampusMarket" }] }),
  component: ShopPage,
});

type Tab = "annonces" | "avis" | "apropos";
type Filter = "toutes" | "disponibles" | "vendues";

function ShopPage() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const userId = session?.user.id;
  const isOwner = userId === id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("annonces");
  const [filter, setFilter] = useState<Filter>("toutes");
  const [reportOpen, setReportOpen] = useState(false);

  const sellerQuery = useSeller(id);
  const listingsQuery = useSellerListings(id, !isOwner);
  const reviewsQuery = useSellerReviews(id);
  const distributionQuery = useSellerRatingDistribution(id);
  const followQuery = useIsFollowing(userId, id);
  const following = followQuery.data ?? false;

  const follow = useMutation({
    mutationFn: (on: boolean) => {
      if (!userId) throw new Error("not-authenticated");
      return setFollowing(userId, id, on);
    },
    onMutate: async (on) => {
      const key = ["following", userId, id];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<boolean>(key);
      qc.setQueryData(key, on);
      return { previous, key };
    },
    onError: (error, _on, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.previous);
      toast.error(friendlyError(error, "Impossible de modifier votre abonnement."));
    },
    onSuccess: (_d, on) => toast.success(on ? `Vous suivez ${sellerQuery.data?.name ?? "ce vendeur"}` : "Vous ne suivez plus ce vendeur"),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["seller", id] }); },
  });

  const contact = useMutation({
    mutationFn: () => {
      if (!userId) throw new Error("not-authenticated");
      return findOrCreateConversation(userId, id);
    },
    onSuccess: (conversationId) => { void navigate({ to: `/messages/${conversationId}` as "/" }); },
    onError: (error) => toast.error(friendlyError(error, "Impossible d'ouvrir la conversation.")),
  });

  const seller = sellerQuery.data ?? undefined;
  const header = <PageHeader title="" className="mb-4 [&_h1]:hidden" breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Marketplace", to: "/marketplace" }, { label: seller?.name ?? "Boutique" }]} />;

  if (sellerQuery.isLoading) {
    return <div>{header}<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <ProductCardSkeleton key={i} />)}</div></div>;
  }
  if (sellerQuery.isError) {
    return <div>{header}{isNetworkError(sellerQuery.error) ? <NetworkErrorScreen compact onRetry={() => void sellerQuery.refetch()} /> : <ServerErrorScreen compact onRetry={() => void sellerQuery.refetch()} />}</div>;
  }
  if (!seller) {
    return <div>{header}<StateScreen icon={Search} title="Vendeur introuvable" description="Ce profil n'existe pas ou a été désactivé." actions={<Button asChild size="lg"><AppLink to="/marketplace">Retour à la marketplace</AppLink></Button>} /></div>;
  }

  const all = listingsQuery.data ?? [];
  const listed = all.filter((p) => (filter === "toutes" ? true : filter === "vendues" ? p.stock === "sold" : p.stock !== "sold" && p.stock !== "expired"));
  const reviews = reviewsQuery.data ?? [];
  const distribution = distributionQuery.data;
  const totalRatings = distribution ? Object.values(distribution).reduce((a, b) => a + b, 0) : 0;
  const counts = ([5, 4, 3, 2, 1] as const).map((n) => ({ n, pct: totalRatings && distribution ? Math.round((distribution[n] / totalRatings) * 100) : 0 }));
  const filters: [Filter, string][] = isOwner ? [["toutes", "Toutes"], ["disponibles", "Disponibles"], ["vendues", "Vendues"]] : [["toutes", "Toutes"], ["disponibles", "Disponibles"]];

  return (
    <div>
      {header}

      {/* Bandeau vendeur */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="brand-glow dot-grid relative h-28 bg-gradient-to-br from-primary/25 via-accent to-secondary sm:h-36" />
        <div className="px-4 pb-5 sm:px-6">
          <div className="-mt-10 flex flex-wrap items-end justify-between gap-4 sm:-mt-12">
            <Avatar name={seller.name} size="xl" src={seller.avatarUrl} className="ring-4 ring-card" />
            <div className="flex flex-wrap gap-2">
              {!isOwner && <Button disabled={contact.isPending} onClick={() => contact.mutate()}><MessageCircle /> Écrire</Button>}
              {!isOwner && <Button variant={following ? "soft" : "outline"} aria-pressed={following} disabled={follow.isPending || followQuery.isLoading} onClick={() => follow.mutate(!following)}>{following ? <Check /> : <UserPlus />}{following ? "Suivi" : "Suivre"}</Button>}
              {isOwner && <Button asChild variant="outline"><AppLink to="/profil/annonces">Gérer mes annonces</AppLink></Button>}
              <Button variant="ghost" size="icon" aria-label="Partager la boutique" onClick={() => { void navigator.clipboard?.writeText(window.location.href); toast.success("Lien de la boutique copié"); }}><Share /></Button>
              {!isOwner && <Button variant="ghost" size="icon" aria-label="Signaler ce vendeur" onClick={() => setReportOpen(true)}><Flag /></Button>}
            </div>
          </div>
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2"><h1 className="font-display text-2xl font-bold">{seller.name}</h1><VerificationBadge verified={seller.verified} compact /></div>
            <p className="mt-1 text-sm text-muted-foreground">{seller.campus || "Campus non renseigné"} · {seller.since}{typeof seller.followers === "number" && seller.followers > 0 ? ` · ${seller.followers} abonné${seller.followers > 1 ? "s" : ""}` : ""}</p>
            {seller.bio && <p className="mt-3 max-w-2xl text-sm leading-6">{seller.bio}</p>}
          </div>
          <dl className="mt-5 grid grid-cols-3 divide-x divide-border rounded-lg bg-secondary/60 py-3 text-center">
            <div><dd className="font-display text-xl font-bold">{seller.listings}</dd><dt className="text-[11px] text-muted-foreground">Annonces</dt></div>
            <div><dd className="font-display text-xl font-bold">{seller.sales}</dd><dt className="text-[11px] text-muted-foreground">Ventes</dt></div>
            <div><dd className="flex items-center justify-center gap-1 font-display text-xl font-bold">{seller.reviews > 0 ? seller.rating.toFixed(1) : "—"}</dd><dt className="text-[11px] text-muted-foreground">Note moyenne</dt></div>
          </dl>
        </div>
      </section>

      {/* Onglets */}
      <div className="mt-6 inline-flex rounded-lg bg-muted p-1" role="tablist" aria-label="Sections de la boutique">
        {([["annonces", `Annonces (${seller.listings})`], ["avis", `Avis (${seller.reviews})`], ["apropos", "À propos"]] as const).map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-md px-4 py-2 text-sm font-semibold transition", tab === t ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground")}>{l}</button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "annonces" && (
          <div>
            <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrer les annonces">
              {filters.map(([f, l]) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={cn("rounded-full border px-4 py-1.5 text-sm font-semibold transition", filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{l}</button>)}
            </div>
            {listingsQuery.isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <ProductCardSkeleton key={i} />)}</div>
            ) : listingsQuery.isError ? (
              <ServerErrorScreen compact onRetry={() => void listingsQuery.refetch()} />
            ) : all.length === 0 ? (
              <EmptyScreen compact title="Aucune annonce pour l'instant" description={`${seller.name} n'a pas d'annonce en ligne. Revenez bientôt !`} />
            ) : listed.length === 0 ? (
              <EmptyScreen compact title="Aucune annonce dans cette catégorie" description="Essayez un autre filtre pour voir les autres annonces du vendeur." />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{listed.map((p) => <ProductCard key={p.id} product={p} />)}</div>
            )}
          </div>
        )}

        {tab === "avis" && (
          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="font-display text-4xl font-bold">{seller.reviews > 0 ? seller.rating.toFixed(1) : "—"}</p>
              <RatingStars value={seller.rating} reviews={seller.reviews} size="md" />
              <ul className="mt-4 space-y-2">{counts.map(({ n, pct }) => <li key={n} className="flex items-center gap-2 text-xs"><span className="w-3 font-semibold">{n}</span><span className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-warning" style={{ width: `${pct}%` }} /></span><span className="w-9 text-right text-muted-foreground">{pct} %</span></li>)}</ul>
            </div>
            {reviewsQuery.isLoading ? <p className="text-sm text-muted-foreground">Chargement des avis…</p> : reviews.length === 0 ? <EmptyScreen compact title="Aucun avis pour le moment" description="Les avis apparaissent après une vente terminée." /> : (
            <ul className="space-y-3">
              {reviews.map((r) => (
                <li key={r.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-3"><Avatar name={r.author} size="sm" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{r.author}</p><p className="text-[11px] text-muted-foreground">{r.date}</p></div><RatingStars value={r.rating} /></div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{r.text}</p>
                </li>
              ))}
            </ul>
            )}
          </div>
        )}

        {tab === "apropos" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-border bg-card p-5"><h2 className="font-display text-lg font-bold">À propos</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">{seller.bio ?? "Ce vendeur n'a pas encore rédigé de présentation."}</p></section>
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="font-display text-lg font-bold">Vérifications</h2>
              <ul className="mt-3 space-y-3 text-sm">
                {[["Identité étudiante vérifiée", seller.verified]].map(([l, ok]) => (
                  <li key={String(l)} className="flex items-center gap-3"><span className={cn("grid size-6 place-items-center rounded-full", ok ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{ok ? <BadgeCheck className="size-4" /> : <Package className="size-4" />}</span><span className={ok ? "font-semibold" : "text-muted-foreground"}>{String(l)}{ok ? "" : " · non vérifiée"}</span></li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>

      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} targetType="profile" targetId={seller.id} subject={seller.name} />
    </div>
  );
}
