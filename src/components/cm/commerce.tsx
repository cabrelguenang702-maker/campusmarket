import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Heart, MessageCircle, Store } from "@/components/icons";
import { formatFcfa, type Product, type Seller } from "@/lib/domain";
import { ConditionBadge, LocationBadge, RatingStars, StatusBadge, StockIndicator, VerificationBadge } from "./badges";
import { useFavorites } from "@/lib/favorites";
import { AppLink } from "./app-link";

/* ---------- Prix ---------- */
export function Price({ value, oldPrice, size = "md", className }: { value: number; oldPrice?: number | undefined; size?: "sm" | "md" | "lg"; className?: string | undefined }) {
  const discount = oldPrice && oldPrice > value ? Math.round((1 - value / oldPrice) * 100) : 0;
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
      <span className={cn("font-display font-bold text-primary", size === "lg" ? "text-3xl" : size === "sm" ? "text-base" : "text-lg")}>{formatFcfa(value)}</span>
      {oldPrice ? <span className="text-xs text-muted-foreground line-through">{formatFcfa(oldPrice)}</span> : null}
      {discount > 0 && <span className="rounded-full bg-destructive/12 px-1.5 py-0.5 text-[10px] font-bold text-destructive">-{discount}%</span>}
    </div>
  );
}

/* ---------- Favori ---------- */
export function FavoriteButton({ active, defaultActive = false, onChange, className, label = "favoris" }: { active?: boolean | undefined; defaultActive?: boolean; onChange?: ((next: boolean) => void) | undefined; className?: string | undefined; label?: string }) {
  const [internal, setInternal] = useState(defaultActive);
  const on = active ?? internal;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={on}
      aria-label={on ? `Retirer des ${label}` : `Ajouter aux ${label}`}
      className={cn("size-9 rounded-full", className)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = !on;
        setInternal(next);
        onChange?.(next);
      }}
    >
      <Heart pack={on ? "filled" : "basic"} className={cn("size-5 transition", on ? "text-destructive" : "text-muted-foreground")} />
    </Button>
  );
}

/* ---------- Avatar ---------- */
export function Avatar({ name, size = "md", className, src }: { name: string; size?: "sm" | "md" | "lg" | "xl"; className?: string | undefined; src?: string | null | undefined }) {
  const initials = name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const dim = { sm: "size-8 text-[11px]", md: "size-10 text-sm", lg: "size-14 text-lg", xl: "size-24 text-3xl" }[size];
  if (src) return <img src={src} alt={name} className={cn("shrink-0 rounded-full object-cover", dim, className)} />;
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full bg-accent font-display font-semibold text-accent-foreground", dim, className)} aria-hidden>
      {initials}
    </span>
  );
}

/* ---------- Visuel produit (dégradé + icône tant qu'il n'y a pas de photo) ---------- */
export function ProductVisual({ product, className }: { product: Pick<Product, "icon" | "tone" | "name"> & { images?: string[] | undefined }; className?: string | undefined }) {
  const Icon = product.icon;
  const photo = product.images?.[0];
  if (photo) {
    return (
      <div className={cn("relative overflow-hidden bg-muted", className)}>
        <img src={photo} alt={product.name} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
      </div>
    );
  }
  return (
    <div className={cn("relative grid place-items-center overflow-hidden bg-gradient-to-br", product.tone, className)} role="img" aria-label={product.name}>
      <div className="dot-grid absolute inset-0 opacity-40" />
      <Icon className="relative size-14 text-primary" />
    </div>
  );
}

/* ---------- Carte produit ---------- */
export function ProductCard({ product, liked, onLike, layout = "grid" }: { product: Product; liked?: boolean | undefined; onLike?: ((next: boolean) => void) | undefined; layout?: "grid" | "row" }) {
  const favorites = useFavorites();
  const dimmed = product.stock === "sold" || product.stock === "expired";
  return (
    <article className={cn("group relative overflow-hidden rounded-lg border border-border bg-card transition hover:border-primary/40 hover:shadow-glow", layout === "row" && "flex", dimmed && "opacity-80")}>
      <AppLink to={`/produit/${product.id}`} className={cn("relative block", layout === "row" ? "w-32 shrink-0 sm:w-44" : "")} aria-label={`Voir ${product.name}`}>
        <ProductVisual product={product} className={cn(layout === "row" ? "h-full min-h-32" : "h-40 w-full")} />
        <span className="absolute left-3 top-3"><ConditionBadge condition={product.condition} /></span>
        {(product.stock === "sold" || product.stock === "reserved" || product.stock === "expired") && (
          <span className="absolute bottom-3 left-3"><StatusBadge status={product.stock} /></span>
        )}
      </AppLink>
      <div className="min-w-0 flex-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <AppLink to={`/produit/${product.id}`} className="min-w-0">
            <h3 className="truncate font-semibold leading-snug group-hover:text-primary">{product.name}</h3>
          </AppLink>
          <FavoriteButton active={liked ?? favorites.has(product.id)} onChange={onLike ?? (() => favorites.toggle(product.id))} className="-mr-2 -mt-2" />
        </div>
        <Price value={product.price} oldPrice={product.oldPrice} className="mt-1" />
        <div className="mt-3 flex items-center justify-between gap-2">
          <LocationBadge campus={product.campus} city={product.city} className="min-w-0" />
          <span className="shrink-0 text-[11px] text-muted-foreground">{product.posted}</span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
          <RatingStars value={product.rating} reviews={product.reviews} />
          <StockIndicator stock={product.stock} />
        </div>
      </div>
    </article>
  );
}

/* ---------- Carte vendeur ---------- */
export function SellerCard({ seller, compact = false }: { seller: Seller; compact?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <Avatar name={seller.name} size="lg" src={seller.avatarUrl} />
        <div className="min-w-0 flex-1">
          <AppLink to={`/boutique/${seller.id}`} className="block truncate font-display font-semibold hover:text-primary">{seller.name}</AppLink>
          <p className="truncate text-xs text-muted-foreground">{seller.campus}</p>
          <div className="mt-1.5"><VerificationBadge verified={seller.verified} compact /></div>
        </div>
      </div>
      {!compact && (
        <>
          <div className="mt-4 grid grid-cols-3 divide-x divide-border rounded-md bg-secondary/60 py-2 text-center">
            <div><p className="font-display text-base font-bold">{seller.listings}</p><p className="text-[10px] text-muted-foreground">Annonces</p></div>
            <div><p className="font-display text-base font-bold">{seller.sales}</p><p className="text-[10px] text-muted-foreground">Ventes</p></div>
            <div><p className="font-display text-base font-bold">{seller.rating}</p><p className="text-[10px] text-muted-foreground">Note</p></div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">{seller.since}</p>
          <div className="mt-3 flex gap-2">
            <Button asChild className="flex-1" size="sm"><AppLink to="/messages"><MessageCircle /> Écrire</AppLink></Button>
            <Button asChild className="flex-1" size="sm" variant="outline"><AppLink to={`/boutique/${seller.id}`}><Store /> Boutique</AppLink></Button>
          </div>
        </>
      )}
    </div>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card" aria-hidden>
      <div className="h-40 animate-pulse bg-foreground/10" />
      <div className="space-y-3 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-foreground/10" />
        <div className="h-5 w-1/2 animate-pulse rounded bg-foreground/10" />
        <div className="h-3 w-full animate-pulse rounded bg-foreground/10" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-foreground/10" />
      </div>
    </div>
  );
}
