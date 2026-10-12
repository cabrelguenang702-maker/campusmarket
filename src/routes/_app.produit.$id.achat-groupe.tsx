import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Check, CheckCircle, Clock, Search, Users } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { Avatar } from "@/components/cm/commerce";
import { InlineAlert, StateScreen } from "@/components/cm/feedback";
import { NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { GroupProgress } from "@/components/marketplace/GroupBuy";
import { ProductGallery } from "@/components/marketplace/ProductGallery";
import { PageHeader } from "@/components/layout/PageHeader";
import { isNetworkError } from "@/lib/api/errors";
import { useGroupBuyForProduct, useGroupParticipants } from "@/lib/api/groupbuys";
import { useProduct } from "@/lib/api/products";
import { formatFcfa } from "@/lib/domain";
import { currentTier, nextTier, savingPercent, timeLeft, type GroupBuy } from "@/lib/groupbuy-model";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/produit/$id/achat-groupe")({
  head: () => ({ meta: [{ title: "Achat groupé — CampusMarket" }] }),
  component: GroupBuyPage,
});

function TierLadder({ group, basePrice }: { group: GroupBuy; basePrice: number }) {
  const next = nextTier(group);
  return (
    <ol className="space-y-2.5">
      {group.tiers.map((t) => {
        const reached = group.joined >= t.qty;
        const isNext = next?.qty === t.qty;
        return (
          <li key={t.qty} className={cn("flex items-center gap-3 rounded-lg border p-3", reached ? "border-success/40 bg-success/5" : isNext ? "border-primary/40 bg-primary/5" : "border-border")}>
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold", reached ? "bg-success text-success-foreground" : isNext ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{reached ? <Check className="size-4" /> : t.qty}</span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{t.qty} participants</span><span className="block text-xs text-muted-foreground">{reached ? "Palier atteint" : isNext ? `Encore ${t.qty - group.joined} pour débloquer` : "À venir"}</span></span>
            <span className="text-right"><span className="block font-display font-bold text-primary">{formatFcfa(t.price)}</span><span className="block text-[11px] text-muted-foreground">-{savingPercent(t.price, basePrice)} %</span></span>
          </li>
        );
      })}
    </ol>
  );
}

function Participants({ group, isOrganizer }: { group: GroupBuy; isOrganizer: boolean }) {
  const { session } = useAuth();
  const query = useGroupParticipants(group.id);
  const list = query.data ?? [];
  const me = session?.user.id;
  const visible = list.length > 0;
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h3 className="font-display text-lg font-bold">Participants ({group.joined})</h3>
      {visible ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">{isOrganizer ? "Les étudiants qui ont rejoint votre achat groupé." : "La liste n'est visible que par les participants et le vendeur."}</p>
          <ul className="mt-4 space-y-2.5">
            {list.slice(0, 8).map((p) => (
              <li key={p.userId} className="flex items-center gap-3"><Avatar name={p.name} size="sm" src={p.avatarUrl} /><span className="text-sm font-semibold">{p.name}{p.userId === me ? " (vous)" : ""}</span></li>
            ))}
          </ul>
          {list.length > 8 && <p className="mt-3 text-xs text-muted-foreground">et {list.length - 8} autres participants</p>}
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">{group.joined === 0 ? "Personne n'a encore rejoint ce groupe." : "La liste des participants n'est visible que par les participants et le vendeur."}</p>
      )}
    </section>
  );
}

function GroupBuyPage() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const productQuery = useProduct(id);
  const groupQuery = useGroupBuyForProduct(id);
  const product = productQuery.data;
  const group = groupQuery.data;

  const header = <PageHeader kicker="Marketplace" title="Achat groupé" breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Marketplace", to: "/marketplace" }, { label: "Achats groupés", to: "/marketplace?vue=groupes" }, { label: product?.name ?? "Annonce" }]} />;

  if (productQuery.isPending || groupQuery.isPending) {
    return <div>{header}<div className="grid gap-8 lg:grid-cols-[1.05fr_1fr]" aria-busy><div className="aspect-[4/3] animate-pulse rounded-xl bg-foreground/10" /><div className="space-y-4"><div className="h-6 w-1/3 animate-pulse rounded bg-foreground/10" /><div className="h-9 w-2/3 animate-pulse rounded bg-foreground/10" /><div className="h-28 animate-pulse rounded-xl bg-foreground/10" /></div></div></div>;
  }
  const failed = productQuery.isError ? productQuery : groupQuery.isError ? groupQuery : null;
  if (failed) return <div>{header}{isNetworkError(failed.error) ? <NetworkErrorScreen compact onRetry={() => void failed.refetch()} /> : <ServerErrorScreen compact onRetry={() => void failed.refetch()} />}</div>;
  if (!product || !group) {
    return (
      <div>
        {header}
        <StateScreen icon={Search} title="Aucun achat groupé pour cette annonce" description="Cet article n'est pas proposé en achat groupé pour le moment." actions={<><Button asChild size="lg"><AppLink to="/marketplace" search={{ vue: "groupes" }}>Voir les achats groupés</AppLink></Button>{product && <Button asChild size="lg" variant="outline"><AppLink to={`/produit/${product.id}`}>Voir l'annonce</AppLink></Button>}</>} />
      </div>
    );
  }

  const { price } = currentTier(group, product.price);
  const saving = savingPercent(price, product.price);
  const next = nextTier(group);
  const closed = group.status !== "actif";
  const isOrganizer = session?.user.id === product.sellerId;

  return (
    <div>
      {header}
      <div className="grid gap-8 lg:grid-cols-[1.05fr_1fr]">
        <ProductGallery product={product} dimmed={closed} />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {group.status === "actif" && <Pill tone="primary" icon={Clock}>Se termine dans {timeLeft(group.endsAt)}</Pill>}
            {group.status === "complet" && <Pill tone="success" icon={CheckCircle}>Objectif atteint</Pill>}
            {group.status === "expire" && <Pill tone="neutral" icon={Clock}>Achat groupé expiré</Pill>}
          </div>
          <h2 className="mt-3 font-display text-2xl font-bold">{product.name}</h2>
          <div className="mt-3 flex flex-wrap items-baseline gap-3">
            <span className="font-display text-3xl font-bold text-primary">{formatFcfa(price)}</span>
            {saving > 0 && <><span className="text-sm text-muted-foreground line-through">{formatFcfa(product.price)}</span><span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-bold text-[oklch(0.42_0.13_155)] dark:text-success">-{saving} %</span></>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Prix par article selon le palier atteint.</p>

          <div className="mt-5 rounded-xl border border-border bg-card p-4">
            <GroupProgress joined={group.joined} target={group.target} />
            {group.status === "actif" && next && <p className="mt-3 text-xs text-muted-foreground">Encore <span className="font-bold text-foreground">{next.qty - group.joined} participants</span> pour passer à <span className="font-bold text-primary">{formatFcfa(next.price)}</span>.</p>}
          </div>

          <div className="mt-5 space-y-3" aria-live="polite">
            {group.status === "complet" && <InlineAlert tone="success" title="L'objectif est atteint">Le nombre de participants visé est atteint.</InlineAlert>}
            {group.status === "expire" && <InlineAlert tone="neutral" title="La date limite est dépassée">Cet achat groupé est terminé.</InlineAlert>}
            {group.status === "actif" && <InlineAlert tone="info" title="Participation bientôt disponible">L'inscription à un achat groupé n'est pas encore ouverte. Vous pouvez déjà suivre sa progression.</InlineAlert>}
          </div>

          <div className="mt-5 space-y-2.5">
            {group.status === "actif" && <Button size="lg" className="w-full" disabled><Users /> Rejoindre le groupe</Button>}
            <Button asChild size="lg" variant="outline" className="w-full"><AppLink to="/marketplace" search={{ vue: "groupes" }}>Voir les autres achats groupés</AppLink></Button>
            <Button asChild variant="ghost" className="w-full"><AppLink to={`/produit/${product.id}`}>Voir l'annonce complète</AppLink></Button>
          </div>
        </div>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="font-display text-lg font-bold">Prix par paliers</h3>
          <p className="mt-1 text-sm text-muted-foreground">Plus il y a de participants, plus le prix baisse pour tout le monde.</p>
          <div className="mt-4">{group.tiers.length > 0 ? <TierLadder group={group} basePrice={product.price} /> : <p className="text-sm text-muted-foreground">Aucun palier défini : le prix reste celui de l'annonce.</p>}</div>
        </section>
        <Participants group={group} isOrganizer={isOrganizer} />
      </div>
    </div>
  );
}
