import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search, X } from "@/components/icons";
import { EmptyScreen, NetworkErrorScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { UniversityCard, UniversityCardSkeleton } from "@/components/directory/UniversityCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { isNetworkError } from "@/lib/api/errors";
import { useDirectory } from "@/lib/api/universities";
import { cn } from "@/lib/utils";

export type DirectorySearch = { q?: string | undefined; pays?: string | undefined; region?: string | undefined; ville?: string | undefined };

export const Route = createFileRoute("/_app/universites/")({
  validateSearch: (s: Record<string, unknown>): DirectorySearch => ({
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    pays: typeof s["pays"] === "string" && /^[A-Za-z]{2}$/.test(s["pays"]) ? s["pays"].toUpperCase() : undefined,
    region: typeof s["region"] === "string" && s["region"] ? s["region"] : undefined,
    ville: typeof s["ville"] === "string" && s["ville"] ? s["ville"] : undefined,
  }),
  head: () => ({ meta: [{ title: "Annuaire des universités — CampusMarket" }, { name: "description", content: "Retrouvez les universités partenaires de CampusMarket en Afrique et découvrez leur vie de campus." }] }),
  component: DirectoryPage,
});

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function DirectoryPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const query = useDirectory();
  const [qInput, setQInput] = useState(search.q ?? "");
  const setSearch = (patch: Partial<DirectorySearch>) => void navigate({ search: (prev) => ({ ...prev, ...patch }) });

  const universities = query.data ?? [];
  const regions = useMemo(() => Array.from(new Set(universities.map((u) => u.region).filter(Boolean))).sort(), [universities]);
  const countries = useMemo(() => Array.from(new Map(universities.map((u) => [u.country, { code: u.country, name: u.countryName, flag: u.flag }])).values()).sort((a, b) => a.name.localeCompare(b.name, "fr")), [universities]);
  const cities = useMemo(() => Array.from(new Set(universities.filter((u) => !search.pays || u.country === search.pays).map((u) => u.city))).sort((a, b) => a.localeCompare(b, "fr")), [universities, search.pays]);

  const q = search.q ? normalize(search.q) : "";
  const results = universities.filter((u) =>
    (!search.pays || u.country === search.pays) &&
    (!search.region || u.region === search.region) &&
    (!search.ville || u.city === search.ville) &&
    (!q || normalize(`${u.name} ${u.short} ${u.city}`).includes(q)),
  );

  let body;
  if (query.isPending) body = <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <UniversityCardSkeleton key={i} />)}</div>;
  else if (query.isError) body = isNetworkError(query.error) ? <NetworkErrorScreen compact onRetry={() => void query.refetch()} /> : <ServerErrorScreen compact onRetry={() => void query.refetch()} />;
  else if (universities.length === 0) body = <EmptyScreen compact title="Aucune université partenaire" description="Les universités partenaires de votre région apparaîtront ici." />;
  else if (results.length === 0) body = <NoResultsScreen compact query={search.q} filtered={!!search.pays || !!search.region || !!search.ville} />;
  else body = <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{results.map((u) => <UniversityCard key={u.id} u={u} />)}</div>;

  const hasFilters = !!(search.pays || search.region || search.ville);

  return (
    <div>
      <PageHeader kicker="Annuaire" title="Universités partenaires" description="Retrouvez votre établissement pour voir ses annonces et ses événements." breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Universités" }]} />

      <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch({ q: qInput.trim() || undefined }); }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Rechercher une université, un sigle, une ville…" aria-label="Rechercher une université" className="h-12 w-full rounded-lg border border-input bg-card pl-11 pr-10 text-base outline-none transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 md:text-sm" />
          {qInput && <button type="button" aria-label="Effacer la recherche" onClick={() => { setQInput(""); setSearch({ q: undefined }); }} className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button>}
        </div>
        <Button type="submit" size="lg" className="h-12 px-4 sm:px-5" aria-label="Rechercher"><Search className="sm:hidden" /><span className="hidden sm:inline">Rechercher</span></Button>
      </form>

      <div className="mt-5 space-y-3">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0" role="group" aria-label="Région">
          <button aria-pressed={!search.region} onClick={() => setSearch({ region: undefined })} className={cn("shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition", !search.region ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>Toutes les régions</button>
          {regions.map((r) => <button key={r} aria-pressed={search.region === r} onClick={() => setSearch({ region: r })} className={cn("shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition", search.region === r ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{r}</button>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Filtrer par pays" value={search.pays ?? ""} onChange={(e) => setSearch({ pays: e.target.value || undefined, ville: undefined })} className="h-10 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-primary">
            <option value="">Tous les pays</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
          </select>
          <select aria-label="Filtrer par ville" value={search.ville ?? ""} onChange={(e) => setSearch({ ville: e.target.value || undefined })} className="h-10 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-primary">
            <option value="">Toutes les villes</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {hasFilters && <Button variant="ghost" size="sm" onClick={() => setSearch({ pays: undefined, region: undefined, ville: undefined })}><X className="size-3.5" /> Réinitialiser</Button>}
        </div>
      </div>

      <p className="mt-5 mb-4 text-sm text-muted-foreground" aria-live="polite">{query.isSuccess && universities.length > 0 && <><span className="font-bold text-foreground">{results.length}</span> établissement{results.length > 1 ? "s" : ""}{search.q && <> pour « <span className="font-semibold text-foreground">{search.q}</span> »</>}</>}</p>
      {body}
    </div>
  );
}
