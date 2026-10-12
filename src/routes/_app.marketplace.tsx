import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, Filter, Grid, List, Plus, Search, Sort, Users, UserSearch, X } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { ProductCard, ProductCardSkeleton } from "@/components/cm/commerce";
import { EmptyScreen, NetworkErrorScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { FiltersPanel } from "@/components/marketplace/FiltersPanel";
import { GroupBuyCard, GroupBuyCardSkeleton } from "@/components/marketplace/GroupBuy";
import { useGroupBuys } from "@/lib/api/groupbuys";
import { PageHeader } from "@/components/layout/PageHeader";
import { countActiveFilters, defaultFilters, sortOptions, type Tri } from "@/lib/catalog";
import { categories, type CategorySlug } from "@/lib/domain";
import { useListings } from "@/lib/api/products";
import { isNetworkError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

type Vue = "annonces" | "groupes";
export type MarketplaceSearch = { q?: string | undefined; categorie?: CategorySlug | undefined; tri?: Tri | undefined; vue?: Vue | undefined };

export const Route = createFileRoute("/_app/marketplace")({
  validateSearch: (s: Record<string, unknown>): MarketplaceSearch => ({
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    categorie: categories.find((c) => c.slug === s["categorie"])?.slug,
    tri: sortOptions.find((o) => o.id === s["tri"])?.id,
    vue: s["vue"] === "groupes" ? "groupes" : undefined,
  }),
  head: () => ({ meta: [{ title: "Marketplace — CampusMarket" }, { name: "description", content: "Achetez et vendez entre étudiants, près de votre campus." }] }),
  component: MarketplacePage,
});

function MarketplacePage() {
  const groupBuysQuery = useGroupBuys();
  const groupBuys = groupBuysQuery.data ?? [];
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [filters, setFilters] = useState(defaultFilters);
  const [advanced, setAdvanced] = useState(false);
  const [layout, setLayout] = useState<"grid" | "row">("grid");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [qInput, setQInput] = useState(search.q ?? "");

  useEffect(() => { setQInput(search.q ?? ""); }, [search.q]);

  const vue: Vue = search.vue ?? "annonces";
  const tri: Tri = search.tri ?? "pertinence";
  const activeFilters = countActiveFilters(filters);
  const category = categories.find((c) => c.slug === search.categorie);

  const listings = useListings({ q: search.q, categorie: search.categorie, filters, tri });
  const { isLoading, isError, error, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } = listings;
  const results = useMemo(() => listings.data?.pages.flatMap((p) => p.items) ?? [], [listings.data]);
  const total = listings.data?.pages[0]?.total ?? 0;

  const setSearch = (patch: Partial<MarketplaceSearch>) => void navigate({ search: (prev) => ({ ...prev, ...patch }) });

  const filtersPanel = (prefix: string) => <FiltersPanel idPrefix={prefix} filters={filters} onChange={setFilters} advanced={advanced} onAdvancedChange={setAdvanced} />;

  let body;
  if (isLoading) {
    body = <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <ProductCardSkeleton key={i} />)}</div>;
  } else if (isError) {
    body = isNetworkError(error) ? <NetworkErrorScreen compact onRetry={() => void refetch()} /> : <ServerErrorScreen compact onRetry={() => void refetch()} />;
  } else if (total === 0) {
    const narrowed = activeFilters > 0 || !!search.categorie || !!search.q;
    body = narrowed ? <NoResultsScreen compact query={search.q} filtered={activeFilters > 0 || !!search.categorie} /> : (
      <EmptyScreen compact title="Aucune annonce sur votre campus" description="Soyez le premier à publier une annonce et lancez la marketplace de votre université." actions={<Button asChild className="hidden sm:inline-flex"><AppLink to="/publier"><Plus /> Publier une annonce</AppLink></Button>} />
    );
  } else {
    body = (
      <>
        <div className={cn("grid gap-4 transition-opacity", layout === "grid" ? "sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-1", isFetching && !isFetchingNextPage && "opacity-60")}>
          {results.map((p) => <ProductCard key={p.id} product={p} layout={layout} />)}
          {isFetchingNextPage && Array.from({ length: 3 }).map((_, i) => <ProductCardSkeleton key={`s${i}`} />)}
        </div>
        <div className="mt-8 flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground">{results.length} sur {total} annonces affichées</p>
          {hasNextPage && <Button variant="outline" size="lg" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>{isFetchingNextPage ? "Chargement…" : "Afficher plus d'annonces"}</Button>}
        </div>
      </>
    );
  }

  return (
    <div>
      <PageHeader kicker="Marketplace" title={vue === "groupes" ? "Achats groupés" : category ? category.name : "Trouvez ce qu'il vous faut"} description={vue === "groupes" ? "Achetez ensemble pour débloquer des prix plus bas. Plus le groupe grandit, plus le prix baisse." : "Des annonces d'étudiants vérifiés, près de votre campus."}
        breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Marketplace" }]} actions={<Button asChild className="hidden sm:inline-flex"><AppLink to="/publier"><Plus /> Publier une annonce</AppLink></Button>} />

      {/* Onglets de vue */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-muted p-1" role="tablist" aria-label="Vue">
          {([["annonces", "Annonces"], ["groupes", groupBuysQuery.isSuccess ? `Achats groupés (${groupBuys.length})` : "Achats groupés"]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={vue === id} onClick={() => setSearch({ vue: id === "groupes" ? "groupes" : undefined })} className={cn("rounded-md px-4 py-2 text-sm font-semibold transition", vue === id ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground")}>{label}</button>
          ))}
        </div>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground"><AppLink to="/je-recherche"><UserSearch /> Je recherche</AppLink></Button>
      </div>

      {vue === "groupes" ? (
        <div>
          <div className="mb-5 rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm"><span className="flex items-center gap-2 font-semibold text-primary"><Users className="size-5" /> Comment ça marche ?</span><p className="mt-1.5 leading-6 text-muted-foreground">Chaque achat groupé a un objectif de participants, des paliers de prix et une date limite : plus le groupe grandit, plus le prix par article baisse pour tout le monde.</p></div>
          {groupBuysQuery.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <GroupBuyCardSkeleton key={i} />)}</div>
          ) : groupBuysQuery.isError ? (
            isNetworkError(groupBuysQuery.error) ? <NetworkErrorScreen compact onRetry={() => void groupBuysQuery.refetch()} /> : <ServerErrorScreen compact onRetry={() => void groupBuysQuery.refetch()} />
          ) : groupBuys.length === 0 ? (
            <EmptyScreen compact title="Aucun achat groupé en cours" description="Les prochains achats groupés de votre campus apparaîtront ici." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{groupBuys.map(({ group, product }) => <GroupBuyCard key={group.id} group={group} product={product} />)}</div>
          )}
        </div>
      ) : (
        <>
          {/* Recherche */}
          <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch({ q: qInput.trim() || undefined }); }}>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
              <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Rechercher une annonce…" aria-label="Rechercher une annonce" className="h-12 w-full rounded-lg border border-input bg-card pl-11 pr-10 text-base outline-none transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 md:text-sm" />
              {qInput && <button type="button" aria-label="Effacer la recherche" onClick={() => { setQInput(""); setSearch({ q: undefined }); }} className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button>}
            </div>
            <Button type="submit" size="lg" className="h-12 px-4 sm:px-5" aria-label="Rechercher"><Search className="sm:hidden" /><span className="hidden sm:inline">Rechercher</span></Button>
          </form>
          {!search.q && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="text-muted-foreground">Recherches populaires :</span>{["MacBook", "iPhone", "Manuels", "Casque"].map((s) => <button key={s} onClick={() => setSearch({ q: s })} className="rounded-full border border-border bg-card px-3 py-1 font-semibold text-muted-foreground hover:border-primary/50 hover:text-foreground">{s}</button>)}</div>
          )}

          {/* Catégories */}
          <div className="no-scrollbar -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0" role="group" aria-label="Catégories">
            <button aria-pressed={!search.categorie} onClick={() => setSearch({ categorie: undefined })} className={cn("shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition", !search.categorie ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>Toutes</button>
            {categories.map(({ slug, name, icon: Icon }) => (
              <button key={slug} aria-pressed={search.categorie === slug} onClick={() => setSearch({ categorie: slug })} className={cn("flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition", search.categorie === slug ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}><Icon className="size-4" />{name}</button>
            ))}
          </div>

          <div className="mt-6 grid gap-7 lg:grid-cols-[250px_1fr]">
            <aside className="hidden lg:block">
              <div className="sticky top-24 rounded-xl border border-border bg-card p-4">
                <p className="mb-4 flex items-center gap-2 font-display text-sm font-bold"><Filter className="size-4 text-primary" /> Filtres</p>
                {filtersPanel("d")}
              </div>
            </aside>

            <div className="min-w-0">
              {/* Barre d'outils */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground" aria-live="polite"><span className="font-bold text-foreground">{total}</span> annonce{total > 1 ? "s" : ""}{search.q && <> pour « <span className="font-semibold text-foreground">{search.q}</span> »</>}{category && <> · {category.name}</>}</p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setSheetOpen(true)}><Filter /> Filtres{activeFilters > 0 && <span className="ml-1 grid size-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{activeFilters}</span>}</Button>
                  <DropdownMenu open={sortOpen} onOpenChange={setSortOpen}>
                    <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Sort /> {sortOptions.find((o) => o.id === tri)?.label}<ChevronDown className="size-4 opacity-60" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuRadioGroup value={tri} onValueChange={(v) => setSearch({ tri: v === "pertinence" ? undefined : (v as Tri) })}>
                        {sortOptions.map((o) => <DropdownMenuRadioItem key={o.id} value={o.id} className="cursor-pointer">{o.label}</DropdownMenuRadioItem>)}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className="hidden rounded-md border border-border p-0.5 sm:flex" role="group" aria-label="Affichage">
                    {([["grid", Grid, "Grille"], ["row", List, "Liste"]] as const).map(([id, Icon, label]) => (
                      <button key={id} aria-label={label} aria-pressed={layout === id} onClick={() => setLayout(id)} className={cn("grid size-8 place-items-center rounded", layout === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><Icon className="size-[18px]" /></button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Filtres actifs */}
              {(activeFilters > 0 || search.categorie) && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  {category && <button onClick={() => setSearch({ categorie: undefined })} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{category.name}<X className="size-3.5" /></button>}
                  {filters.etats.map((e) => <button key={e} onClick={() => setFilters({ ...filters, etats: filters.etats.filter((x) => x !== e) })} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{e}<X className="size-3.5" /></button>)}
                  {filters.campus !== "tous" && <button onClick={() => setFilters({ ...filters, campus: "tous" })} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{filters.campus}<X className="size-3.5" /></button>}
                  <button onClick={() => { setFilters(defaultFilters); setSearch({ categorie: undefined }); }} className="text-xs font-semibold text-muted-foreground underline">Tout effacer</button>
                </div>
              )}

              {body}
            </div>
          </div>
        </>
      )}

      {/* Feuille de filtres (mobile) */}
      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent className="max-h-[88vh]">
          <DrawerHeader className="text-left"><DrawerTitle className="font-display">Filtres</DrawerTitle><DrawerDescription>Affinez les annonces selon vos critères.</DrawerDescription></DrawerHeader>
          <div className="overflow-y-auto px-4 pb-2">{filtersPanel("m")}</div>
          <DrawerFooter><Button size="lg" onClick={() => setSheetOpen(false)}>Voir les {total} résultats</Button></DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
