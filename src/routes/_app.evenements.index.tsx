import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Plus, Search, X } from "@/components/icons";
import { EmptyScreen, NetworkErrorScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { AppLink } from "@/components/cm/app-link";
import { EventCard, EventCardSkeleton } from "@/components/events/EventCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { isNetworkError } from "@/lib/api/errors";
import { useEventCategories, useEvents, useMyTickets } from "@/lib/api/events";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export type EventsSearch = { q?: string | undefined; categorie?: string | undefined };

export const Route = createFileRoute("/_app/evenements/")({
  validateSearch: (s: Record<string, unknown>): EventsSearch => ({ q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined, categorie: typeof s["categorie"] === "string" && s["categorie"] ? s["categorie"] : undefined }),
  head: () => ({ meta: [{ title: "Événements — CampusMarket" }, { name: "description", content: "Hackathons, soirées, forums et tournois organisés par votre campus et ses communautés." }] }),
  component: EventsPage,
});

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function EventsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { session } = useAuth();
  const query = useEvents();
  const categories = useEventCategories().data ?? [];
  const tickets = useMyTickets(session?.user.id).data ?? [];
  const registered = new Set(tickets.filter((t) => t.status === "valid" || t.status === "used").map((t) => t.eventId));
  const [qInput, setQInput] = useState(search.q ?? "");
  useEffect(() => { setQInput(search.q ?? ""); }, [search.q]);
  const setSearch = (patch: Partial<EventsSearch>) => void navigate({ search: (prev) => ({ ...prev, ...patch }) });

  const events = query.data ?? [];
  const q = search.q ? normalize(search.q) : "";
  const results = events.filter((e) => (!search.categorie || e.categorySlug === search.categorie) && (!q || normalize(`${e.name} ${e.description} ${e.category} ${e.place}`).includes(q)));

  let body;
  if (query.isPending) body = <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <EventCardSkeleton key={i} />)}</div>;
  else if (query.isError) body = isNetworkError(query.error) ? <NetworkErrorScreen compact onRetry={() => void query.refetch()} /> : <ServerErrorScreen compact onRetry={() => void query.refetch()} />;
  else if (events.length === 0) body = <EmptyScreen compact title="Aucun événement pour l'instant" description="Les prochains événements de votre campus apparaîtront ici." actions={<Button asChild><AppLink to="/evenements/creer"><Plus /> Créer un événement</AppLink></Button>} />;
  else if (results.length === 0) body = <NoResultsScreen compact query={search.q} filtered={!!search.categorie} />;
  else body = <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{results.map((e) => <EventCard key={e.id} event={e} registered={registered.has(e.id)} />)}</div>;

  return (
    <div>
      <PageHeader kicker="Événements" title="Ce qui se passe sur votre campus" description="Hackathons, soirées, forums et tournois organisés par les communautés et les universités." breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Événements" }]}
        actions={<Button asChild size="lg"><AppLink to="/evenements/creer"><Plus /> Créer un événement</AppLink></Button>} />

      <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch({ q: qInput.trim() || undefined }); }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Rechercher un événement…" aria-label="Rechercher un événement" className="h-12 w-full rounded-lg border border-input bg-card pl-11 pr-10 text-base outline-none transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 md:text-sm" />
          {qInput && <button type="button" aria-label="Effacer la recherche" onClick={() => { setQInput(""); setSearch({ q: undefined }); }} className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button>}
        </div>
        <Button type="submit" size="lg" className="h-12 px-4 sm:px-5" aria-label="Rechercher"><Search className="sm:hidden" /><span className="hidden sm:inline">Rechercher</span></Button>
      </form>

      <div className="no-scrollbar -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0" role="group" aria-label="Catégories">
        <button aria-pressed={!search.categorie} onClick={() => setSearch({ categorie: undefined })} className={cn("shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition", !search.categorie ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>Toutes</button>
        {categories.map((c) => <button key={c.slug} aria-pressed={search.categorie === c.slug} onClick={() => setSearch({ categorie: c.slug })} className={cn("shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition", search.categorie === c.slug ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{c.name}</button>)}
      </div>

      <p className="mt-5 mb-4 text-sm text-muted-foreground" aria-live="polite">{query.isSuccess && events.length > 0 && <><span className="font-bold text-foreground">{results.length}</span> événement{results.length > 1 ? "s" : ""}{search.q && <> pour « <span className="font-semibold text-foreground">{search.q}</span> »</>}</>}</p>
      {body}
    </div>
  );
}
