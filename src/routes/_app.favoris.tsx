import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Trash } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { ProductCard, ProductCardSkeleton } from "@/components/cm/commerce";
import { ConfirmDialog, InlineAlert } from "@/components/cm/feedback";
import { EmptyFavoritesScreen, NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { useFavorites } from "@/lib/favorites";
import { useProductsByIds } from "@/lib/api/products";
import { isNetworkError } from "@/lib/api/errors";
import type { Product } from "@/lib/domain";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/favoris")({
  head: () => ({ meta: [{ title: "Mes favoris — CampusMarket" }] }),
  component: FavoritesPage,
});

/** actif : achetable ; cloture : vendue ou expirée (toujours lisible) ; supprime : plus lisible (supprimée ou retirée). */
type Kind = "actif" | "cloture" | "supprime";
type Entry = { id: string; kind: Kind; product?: Product };

function toEntry(id: string, product: Product | null | undefined): Entry {
  if (!product) return { id, kind: "supprime" };
  return { id, kind: product.stock === "sold" || product.stock === "expired" ? "cloture" : "actif", product };
}

function GhostCard({ onRemove }: { onRemove: () => void }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-dashed border-border bg-card/60">
      <div className="grid h-40 place-items-center bg-muted/60">
        <span className="grid size-14 place-items-center rounded-2xl bg-secondary text-muted-foreground"><AlertTriangle className="size-7" /></span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Annonce indisponible</p>
        <h3 className="mt-1 font-semibold">Cette annonce n'est plus visible</h3>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Elle a été supprimée par son vendeur ou retirée par la modération.</p>
        <div className="mt-auto grid gap-2 pt-4">
          <Button variant="outline" size="sm" onClick={onRemove}><Trash /> Retirer des favoris</Button>
          <Button asChild variant="ghost" size="sm"><AppLink to="/marketplace">Voir des articles similaires</AppLink></Button>
        </div>
      </div>
    </article>
  );
}

function FavoritesPage() {
  const favorites = useFavorites();
  const [filter, setFilter] = useState<"tous" | "disponibles" | "indisponibles">("tous");
  const [confirmClear, setConfirmClear] = useState(false);

  const products = useProductsByIds(favorites.ids);
  const entries = useMemo(() => favorites.ids.map((id, i) => toEntry(id, products.data?.[i])), [favorites.ids, products.data]);
  const shown = entries.filter((e) => (filter === "disponibles" ? e.kind === "actif" : filter === "indisponibles" ? e.kind !== "actif" : true));
  const unavailable = entries.filter((e) => e.kind !== "actif").length;
  const empty = !favorites.loading && favorites.ids.length === 0;
  const loading = favorites.loading || (favorites.ids.length > 0 && products.isLoading);

  return (
    <div>
      <PageHeader kicker="Mon espace" title="Mes favoris" description={empty ? "Retrouvez ici les annonces qui vous intéressent." : `${favorites.ids.length} annonce${favorites.ids.length > 1 ? "s" : ""} enregistrée${favorites.ids.length > 1 ? "s" : ""}.`}
        breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Favoris" }]}
        actions={!empty && !loading ? <Button variant="outline" onClick={() => setConfirmClear(true)}><Trash /> Tout effacer</Button> : undefined} />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <ProductCardSkeleton key={i} />)}</div>
      ) : products.isError ? (
        isNetworkError(products.error) ? <NetworkErrorScreen compact onRetry={() => void products.refetch()} /> : <ServerErrorScreen compact onRetry={() => void products.refetch()} />
      ) : empty ? (
        <EmptyFavoritesScreen />
      ) : (
        <>
          {unavailable > 0 && <InlineAlert tone="warning" className="mb-4" title="Certaines annonces ne sont plus disponibles">Elles sont vendues, expirées ou supprimées. Vous pouvez les retirer de vos favoris.</InlineAlert>}
          <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="Filtrer les favoris">
            {([["tous", `Tous (${entries.length})`], ["disponibles", `Disponibles (${entries.length - unavailable})`], ["indisponibles", `Indisponibles (${unavailable})`]] as const).map(([id, label]) => (
              <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)} className={cn("rounded-full border px-4 py-2 text-sm font-semibold transition", filter === id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{label}</button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Aucune annonce dans cette sélection.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((e) => e.product ? <ProductCard key={e.id} product={e.product} /> : <GhostCard key={e.id} onRemove={() => favorites.remove(e.id)} />)}
            </div>
          )}
        </>
      )}

      <ConfirmDialog open={confirmClear} onOpenChange={setConfirmClear} destructive title="Vider vos favoris ?" description="Toutes les annonces enregistrées seront retirées de votre liste." confirmLabel="Tout effacer" onConfirm={() => favorites.clear()} />
    </div>
  );
}
