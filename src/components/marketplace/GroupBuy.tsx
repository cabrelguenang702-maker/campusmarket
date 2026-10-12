import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Clock, Users } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { ProductVisual } from "@/components/cm/commerce";
import { currentTier, savingPercent, timeLeft, type GroupBuy } from "@/lib/groupbuy-model";
import { formatFcfa, type Product } from "@/lib/domain";

/** Barre de progression d'un achat groupé (participants / objectif). */
export function GroupProgress({ joined, target, className }: { joined: number; target: number; className?: string }) {
  const pct = Math.min(100, Math.round((joined / target) * 100));
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-semibold"><Users className="size-4 text-primary" />{joined} / {target} participants</span>
        <span className="font-bold text-primary">{pct} %</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={joined}>
        <div className={cn("h-full rounded-full transition-all", joined >= target ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function GroupBuyCard({ group, product }: { group: GroupBuy; product: Product }) {
  const { price } = currentTier(group, product.price);
  const saving = savingPercent(price, product.price);
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card transition hover:border-primary/40 hover:shadow-glow">
      <AppLink to={`/produit/${product.id}/achat-groupe`} className="relative block" aria-label={`Voir l'achat groupé ${product.name}`}>
        <ProductVisual product={product} className="h-36 w-full" />
        <span className="absolute left-3 top-3">
          {group.status === "actif" && <Pill tone="primary" icon={Clock}>Se termine dans {timeLeft(group.endsAt)}</Pill>}
          {group.status === "complet" && <Pill tone="success">Objectif atteint</Pill>}
          {group.status === "expire" && <Pill tone="neutral">Expiré</Pill>}
        </span>
      </AppLink>
      <div className="p-4">
        <h3 className="truncate font-semibold">{product.name}</h3>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-display text-lg font-bold text-primary">{formatFcfa(price)}</span>
          {saving > 0 && <><span className="text-xs text-muted-foreground line-through">{formatFcfa(product.price)}</span><span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-bold text-[oklch(0.42_0.13_155)] dark:text-success">-{saving}%</span></>}
        </div>
        <GroupProgress joined={group.joined} target={group.target} className="mt-4" />
        <Button asChild size="sm" variant={group.status === "actif" ? "default" : "outline"} className="mt-4 w-full"><AppLink to={`/produit/${product.id}/achat-groupe`}>Voir le détail</AppLink></Button>
      </div>
    </article>
  );
}

export function GroupBuyCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card" aria-hidden>
      <div className="h-36 animate-pulse bg-foreground/10" />
      <div className="space-y-3 p-4"><div className="h-4 w-3/4 animate-pulse rounded bg-foreground/10" /><div className="h-5 w-1/3 animate-pulse rounded bg-foreground/10" /><div className="h-2.5 w-full animate-pulse rounded-full bg-foreground/10" /></div>
    </div>
  );
}
