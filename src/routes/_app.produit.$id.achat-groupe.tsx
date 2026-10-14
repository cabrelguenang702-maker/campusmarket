import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Check, CheckCircle, Clock, Lock, Plus, Search, Users } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { Avatar } from "@/components/cm/commerce";
import { ConfirmDialog, InlineAlert, StateScreen } from "@/components/cm/feedback";
import { NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { GroupProgress } from "@/components/marketplace/GroupBuy";
import { CreateGroupBuyDialog } from "@/components/marketplace/CreateGroupBuyDialog";
import { UNBLOCK_FEE, UnblockDialog } from "@/components/marketplace/UnblockDialog";
import { ProductGallery } from "@/components/marketplace/ProductGallery";
import { PageHeader } from "@/components/layout/PageHeader";
import { isNetworkError } from "@/lib/api/errors";
import { useGroupBuyActions, useGroupBuyForProduct, useGroupParticipants, useMyGroupBuyBlock, useMyParticipation } from "@/lib/api/groupbuys";
import { useProduct } from "@/lib/api/products";
import { formatFcfa } from "@/lib/domain";
import { currentTier, formatDeadline, nextTier, savingPercent, timeLeft, type GroupBuy } from "@/lib/groupbuy-model";
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
  const me = session?.user.id;
  const productQuery = useProduct(id);
  const groupQuery = useGroupBuyForProduct(id);
  const product = productQuery.data;
  const group = groupQuery.data;
  const participation = useMyParticipation(group?.id, me);
  const blockQuery = useMyGroupBuyBlock(me);
  const acts = useGroupBuyActions();
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [unblockOpen, setUnblockOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const header = <PageHeader kicker="Marketplace" title="Achat groupé" breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Marketplace", to: "/marketplace" }, { label: "Achats groupés", to: "/marketplace?vue=groupes" }, { label: product?.name ?? "Annonce" }]} />;

  if (productQuery.isPending || groupQuery.isPending) {
    return <div>{header}<div className="grid gap-8 lg:grid-cols-[1.05fr_1fr]" aria-busy><div className="aspect-[4/3] animate-pulse rounded-xl bg-foreground/10" /><div className="space-y-4"><div className="h-6 w-1/3 animate-pulse rounded bg-foreground/10" /><div className="h-9 w-2/3 animate-pulse rounded bg-foreground/10" /><div className="h-28 animate-pulse rounded-xl bg-foreground/10" /></div></div></div>;
  }
  const failed = productQuery.isError ? productQuery : groupQuery.isError ? groupQuery : null;
  if (failed) return <div>{header}{isNetworkError(failed.error) ? <NetworkErrorScreen compact onRetry={() => void failed.refetch()} /> : <ServerErrorScreen compact onRetry={() => void failed.refetch()} />}</div>;

  const canCreate = !!product && me === product.sellerId && product.status === "published" && product.quantity >= 2;
  if (!product) {
    return <div>{header}<StateScreen icon={Search} title="Annonce introuvable" description="Cette annonce n'existe plus." actions={<Button asChild size="lg"><AppLink to="/marketplace">Retour à la marketplace</AppLink></Button>} /></div>;
  }
  if (!group) {
    return (
      <div>
        {header}
        <StateScreen icon={Search} title="Aucun achat groupé pour cette annonce" description={canCreate ? "Proposez un prix dégressif : plus vous avez de participants, plus le prix baisse pour tous." : "Cet article n'est pas proposé en achat groupé pour le moment."}
          actions={<>{canCreate && <Button size="lg" onClick={() => setCreateOpen(true)}><Plus /> Créer un achat groupé</Button>}<Button asChild size="lg" variant={canCreate ? "outline" : "default"}><AppLink to="/marketplace" search={{ vue: "groupes" }}>Voir les achats groupés</AppLink></Button><Button asChild size="lg" variant="outline"><AppLink to={`/produit/${product.id}`}>Voir l'annonce</AppLink></Button></>} />
        {canCreate && <CreateGroupBuyDialog open={createOpen} onOpenChange={setCreateOpen} product={{ id: product.id, name: product.name, price: product.price, quantity: product.quantity }} onCreated={() => void groupQuery.refetch()} />}
      </div>
    );
  }

  const part = participation.data;
  const tier = currentTier(group, product.price);
  const price = group.finalPrice ?? tier.price;
  const saving = savingPercent(price, product.price);
  const next = nextTier(group);
  const closed = group.status !== "actif";
  const isOrganizer = me === product.sellerId;
  const committed = part?.status === "committed";
  const paid = part?.status === "paid";
  const blockedUntil = blockQuery.data && new Date(blockQuery.data).getTime() > Date.now() ? blockQuery.data : null;
  const payOpen = group.status === "complet" && committed && !!part?.payDeadline && new Date(part.payDeadline).getTime() > Date.now();

  const join = () => acts.join.mutate(group.id, {
    onSuccess: () => toast.success("Vous avez rejoint l'achat groupé", { description: "Rien n'est débité maintenant." }),
    onError: (e) => { toast.error("Impossible de rejoindre", { description: acts.errorText(e) }); void blockQuery.refetch(); void groupQuery.refetch(); },
  });
  const leave = () => acts.leave.mutate(group.id, {
    onSuccess: () => toast.success("Vous vous êtes retiré·e du groupe", { description: "Vous ne pouvez plus rejoindre d'achat groupé pendant 48 h." }),
    onError: (e) => toast.error("Impossible de se retirer", { description: acts.errorText(e) }),
  });
  const cancel = () => acts.cancel.mutate(group.id, {
    onSuccess: () => toast.success("Achat groupé annulé", { description: "Les participants ont été prévenus. Aucun paiement n'était en jeu." }),
    onError: (e) => toast.error("Annulation impossible", { description: acts.errorText(e) }),
  });

  return (
    <div>
      {header}
      <div className="grid gap-8 lg:grid-cols-[1.05fr_1fr]">
        <ProductGallery product={product} dimmed={closed && !payOpen} />
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
          <p className="mt-1 text-xs text-muted-foreground">{group.finalPrice != null ? "Prix final par article, identique pour tous les participants." : "Prix par article selon le palier atteint."}</p>

          <div className="mt-5 rounded-xl border border-border bg-card p-4">
            <GroupProgress joined={group.joined} target={group.target} />
            {group.status === "actif" && next && <p className="mt-3 text-xs text-muted-foreground">Encore <span className="font-bold text-foreground">{next.qty - group.joined} participants</span> pour passer à <span className="font-bold text-primary">{formatFcfa(next.price)}</span>.</p>}
          </div>

          <div className="mt-5 space-y-3" aria-live="polite">
            {isOrganizer && group.status === "actif" && <InlineAlert tone="neutral" title="C'est votre achat groupé">Les participants s'engagent sans payer. À l'objectif atteint, ils paient chacun au prix final pendant 48 h ; vous êtes prévenu·e de chaque paiement.</InlineAlert>}
            {isOrganizer && group.status === "complet" && <InlineAlert tone="success" title="Objectif atteint">Les participants ont 48 h pour payer. Les commandes payées apparaissent dans vos ventes.</InlineAlert>}
            {!isOrganizer && group.status === "actif" && committed && <InlineAlert tone="success" title="Vous participez à cet achat groupé">Rien n'est débité maintenant. Si l'objectif est atteint, vous aurez 48 h pour payer au prix final.</InlineAlert>}
            {!isOrganizer && group.status === "complet" && committed && payOpen && part?.payDeadline && <InlineAlert tone="warning" title="À vous de payer">Payez avant le {formatDeadline(part.payDeadline)} pour garder votre place au prix de {formatFcfa(part.unitPrice ?? price)}. Passé ce délai, votre place est libérée et vous êtes bloqué·e 48 h pour les achats groupés.</InlineAlert>}
            {!isOrganizer && paid && <InlineAlert tone="success" title="Vous avez payé">Retrouvez votre commande dans « Mes achats ».</InlineAlert>}
            {!isOrganizer && group.status === "complet" && !committed && !paid && <InlineAlert tone="neutral" title="L'objectif est atteint">Les inscriptions à cet achat groupé sont closes.</InlineAlert>}
            {group.status === "expire" && <InlineAlert tone="neutral" title="La date limite est dépassée">Cet achat groupé est terminé : l'objectif n'a pas été atteint, personne n'a rien payé.</InlineAlert>}
            {!isOrganizer && group.status === "actif" && !committed && blockedUntil && (
              <InlineAlert tone="warning" title="Achats groupés bloqués" action={<Button size="sm" variant="outline" onClick={() => setUnblockOpen(true)}>Débloquer · {formatFcfa(UNBLOCK_FEE)}</Button>}>
                Un engagement précédent n'a pas été tenu. Vous pourrez rejoindre à nouveau le {formatDeadline(blockedUntil)}, ou lever le blocage tout de suite.
              </InlineAlert>
            )}
          </div>

          <div className="mt-5 space-y-2.5">
            {payOpen && !isOrganizer && <Button asChild size="lg" className="w-full"><AppLink to={`/produit/${product.id}/acheter`} search={{ groupe: group.id }}>Payer {formatFcfa(part?.unitPrice ?? price)}</AppLink></Button>}
            {group.status === "actif" && !isOrganizer && !committed && !paid && (
              !me ? <Button asChild size="lg" className="w-full"><AppLink to="/connexion"><Users /> Se connecter pour rejoindre</AppLink></Button>
                : <Button size="lg" className="w-full" disabled={!!blockedUntil || acts.join.isPending} onClick={join}>{blockedUntil ? <Lock /> : <Users />} {acts.join.isPending ? "Inscription…" : "Rejoindre le groupe"}</Button>
            )}
            {!isOrganizer && committed && (group.status === "actif" || payOpen) && <Button size="lg" variant="outline" className="w-full" disabled={acts.leave.isPending} onClick={() => setLeaveOpen(true)}>Me retirer du groupe</Button>}
            {isOrganizer && group.status === "actif" && <Button size="lg" variant="outline" className="w-full" disabled={acts.cancel.isPending} onClick={() => setCancelOpen(true)}>Annuler l'achat groupé</Button>}
            <Button asChild size="lg" variant="outline" className="w-full"><AppLink to="/marketplace" search={{ vue: "groupes" }}>Voir les autres achats groupés</AppLink></Button>
            <Button asChild variant="ghost" className="w-full"><AppLink to={`/produit/${product.id}`}>Voir l'annonce complète</AppLink></Button>
          </div>
          {group.status === "actif" && !isOrganizer && !committed && !paid && !blockedUntil && <p className="mt-3 text-xs text-muted-foreground">Rejoindre est un engagement : si vous vous retirez ou ne payez pas dans les 48 h après l'objectif atteint, vous ne pourrez plus rejoindre d'achat groupé pendant 48 h (ou pour {formatFcfa(UNBLOCK_FEE)}).</p>}
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

      <ConfirmDialog open={leaveOpen} onOpenChange={setLeaveOpen} destructive title="Vous retirer du groupe ?" description="Votre engagement sera annulé, mais vous ne pourrez plus rejoindre d'achat groupé pendant 48 h (ou en payant 500 F pour lever le blocage)." confirmLabel="Me retirer" cancelLabel="Rester dans le groupe" onConfirm={leave} />
      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} destructive title="Annuler cet achat groupé ?" description="Les participants seront prévenus et leur engagement prend fin, sans blocage. Rien n'ayant été payé, il n'y a rien à rembourser." confirmLabel="Annuler l'achat groupé" cancelLabel="Le garder" onConfirm={cancel} />
      <UnblockDialog open={unblockOpen} onOpenChange={setUnblockOpen} userId={me} blockedUntil={blockedUntil} />
    </div>
  );
}
