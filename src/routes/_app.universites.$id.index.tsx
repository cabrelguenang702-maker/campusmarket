import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { AppLink } from "@/components/cm/app-link";
import { NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { StateScreen } from "@/components/cm/feedback";
import { ProductCard, ProductCardSkeleton } from "@/components/cm/commerce";
import { EventCard, EventCardSkeleton } from "@/components/events/EventCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { Buildings, MapPin, Search, Store, Ticket, Users } from "@/components/icons";
import { isNetworkError } from "@/lib/api/errors";
import { useCampusEvents, useCampusListings, useUniversity } from "@/lib/api/universities";

export const Route = createFileRoute("/_app/universites/$id/")({
  head: () => ({ meta: [{ title: "Université — CampusMarket" }] }),
  component: UniversityDetailPage,
});

const retry = (error: unknown, onRetry: () => void) => (isNetworkError(error) ? <NetworkErrorScreen compact onRetry={onRetry} /> : <ServerErrorScreen compact onRetry={onRetry} />);

function UniversityDetailPage() {
  const { id } = Route.useParams();
  const query = useUniversity(id);
  const u = query.data;
  const listings = useCampusListings(u?.short);
  const events = useCampusEvents(u?.short);

  const header = <PageHeader kicker="Université" title={u?.name ?? "Université"} breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Universités", to: "/universites" }, { label: u?.name ?? "Détail" }]} />;

  if (query.isPending) return <div>{header}<div aria-busy className="grid gap-8 lg:grid-cols-[1fr_320px]"><div className="h-56 animate-pulse rounded-2xl bg-foreground/10" /><div className="h-40 animate-pulse rounded-xl bg-foreground/10" /></div></div>;
  if (query.isError) return <div>{header}{retry(query.error, () => void query.refetch())}</div>;
  if (!u) return <div>{header}<StateScreen icon={Search} title="Université introuvable" description="Cet établissement ne fait pas partie de l'annuaire." actions={<Button asChild size="lg"><AppLink to="/universites">Voir l'annuaire</AppLink></Button>} /></div>;

  const products = listings.data?.items ?? [];
  const eventList = events.data ?? [];

  return (
    <div>
      {header}
      <div className="relative mb-6 flex items-center gap-4 overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-400/30 to-blue-900/30 p-6">
        <div className="dot-grid absolute inset-0 opacity-40" />
        <span className="relative grid size-16 shrink-0 place-items-center rounded-2xl bg-background/80 text-primary"><Buildings className="size-8" /></span>
        <div className="relative min-w-0">
          <p className="font-display text-xl font-bold">{u.name}</p>
          <p className="text-sm text-foreground/80">{u.short}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground/80"><span className="flex items-center gap-1.5"><MapPin className="size-4" />{u.city} · {u.flag} {u.countryName}</span>{u.studentCount != null && <span className="flex items-center gap-1.5"><Users className="size-4" />{u.students}</span>}</p>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-8">
          <section>
            <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 font-display text-lg font-bold"><Store className="size-5 text-primary" /> Sur le marketplace</h2><AppLink to="/marketplace" className="text-sm font-semibold text-primary hover:underline">Voir le marketplace</AppLink></div>
            {listings.isPending ? <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map((i) => <ProductCardSkeleton key={i} />)}</div>
              : listings.isError ? retry(listings.error, () => void listings.refetch())
              : products.length === 0 ? <p className="text-sm text-muted-foreground">Aucune annonce active sur ce campus pour l'instant.</p>
              : <div className="grid gap-4 sm:grid-cols-2">{products.map((p) => <ProductCard key={p.id} product={p} />)}</div>}
          </section>
          <section>
            <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 font-display text-lg font-bold"><Ticket className="size-5 text-primary" /> Événements à venir</h2><AppLink to="/evenements" className="text-sm font-semibold text-primary hover:underline">Voir les événements</AppLink></div>
            {events.isPending ? <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map((i) => <EventCardSkeleton key={i} />)}</div>
              : events.isError ? retry(events.error, () => void events.refetch())
              : eventList.length === 0 ? <p className="text-sm text-muted-foreground">Aucun événement à venir sur ce campus.</p>
              : <div className="grid gap-4 sm:grid-cols-2">{eventList.slice(0, 4).map((e) => <EventCard key={e.id} event={e} />)}</div>}
          </section>
        </div>
        <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Annonces actives</p><p className="mt-1 font-display text-2xl font-bold text-primary">{listings.isSuccess ? listings.data.total : "–"}</p></div>
          <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Événements à venir</p><p className="mt-1 font-display text-2xl font-bold text-primary">{events.isSuccess ? eventList.length : "–"}</p></div>
          {u.studentCount != null && <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Effectif</p><p className="mt-1 font-display text-2xl font-bold text-primary">{u.students}</p></div>}
        </aside>
      </div>
    </div>
  );
}
