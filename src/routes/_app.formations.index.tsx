import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, Filter, GraduationCap, Search, Sort, X } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { EmptyScreen, NetworkErrorScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { CourseCard, CourseCardSkeleton, ProgressBar } from "@/components/academy/CourseCard";
import { CourseFilters, countCourseFilters, defaultCourseFilters } from "@/components/academy/CourseFilters";
import { PageHeader } from "@/components/layout/PageHeader";
import { courseMinutes, courseProgress, formatDuration, nextModule, styleOfCategory, type Course } from "@/lib/academy-model";
import { fetchCourseCategories, useCourses, useLearner } from "@/lib/api/academy";
import { isNetworkError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

type Vue = "catalogue" | "mes";
type Tri = "populaires" | "notes" | "recentes";
export type AcademySearch = { q?: string | undefined; categorie?: string | undefined; vue?: Vue | undefined; tri?: Tri | undefined };

const triOptions: { id: Tri; label: string }[] = [
  { id: "populaires", label: "Les plus suivies" },
  { id: "notes", label: "Mieux notées" },
  { id: "recentes", label: "Récemment mises à jour" },
];

export const Route = createFileRoute("/_app/formations/")({
  validateSearch: (s: Record<string, unknown>): AcademySearch => ({
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    categorie: typeof s["categorie"] === "string" && s["categorie"] ? s["categorie"] : undefined,
    vue: s["vue"] === "mes" ? "mes" : undefined,
    tri: triOptions.find((t) => t.id === s["tri"])?.id,
  }),
  head: () => ({ meta: [{ title: "Campus Academy — CampusMarket" }, { name: "description", content: "Formations gratuites et payantes, avec certificat, pour réussir vos études et vos projets." }] }),
  component: CatalogPage,
});

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function CatalogPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { session } = useAuth();
  const coursesQuery = useCourses();
  const learner = useLearner(session?.user.id).data;
  const categories = useQuery({ queryKey: ["academy", "categories"], queryFn: fetchCourseCategories, enabled: getSupabase() !== null, staleTime: 10 * 60_000 }).data ?? [];
  const [filters, setFilters] = useState(defaultCourseFilters);
  const [sheet, setSheet] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [qInput, setQInput] = useState(search.q ?? "");
  useEffect(() => { setQInput(search.q ?? ""); }, [search.q]);

  const courses: Course[] = coursesQuery.data ?? [];
  const completed = learner?.completed ?? new Set<string>();
  const vue: Vue = search.vue ?? "catalogue";
  const tri: Tri = search.tri ?? "populaires";
  const setSearch = (patch: Partial<AcademySearch>) => void navigate({ search: (prev) => ({ ...prev, ...patch }) });

  const results = useMemo(() => {
    const q = search.q ? normalize(search.q) : "";
    const list = courses.filter((c) => {
      if (search.categorie && c.categorySlug !== search.categorie) return false;
      if (q && !normalize(`${c.title} ${c.tagline} ${c.category} ${c.instructor.name}`).includes(q)) return false;
      if (filters.niveau !== "tous" && c.level !== filters.niveau) return false;
      if (filters.prix === "gratuit" && c.price > 0) return false;
      if (filters.prix === "payant" && c.price === 0) return false;
      const min = courseMinutes(c);
      if (filters.duree === "court" && min >= 90) return false;
      if (filters.duree === "moyen" && (min < 90 || min > 120)) return false;
      if (filters.duree === "long" && min <= 120) return false;
      return c.rating >= filters.note;
    });
    return [...list].sort((a, b) => (tri === "notes" ? b.rating - a.rating : tri === "recentes" ? b.updatedAt.localeCompare(a.updatedAt) : b.students - a.students));
  }, [courses, search.q, search.categorie, filters, tri]);

  const mine = courses.filter((c) => learner?.enrolled.has(c.id));
  const inProgress = mine.filter((c) => !courseProgress(c, completed).complete);
  const done = mine.filter((c) => courseProgress(c, completed).complete);
  const active = countCourseFilters(filters);
  const resume = inProgress[0];
  const resumeNext = resume ? nextModule(resume, completed) : undefined;

  const grid = (list: Course[]) => <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{list.map((c) => <CourseCard key={c.id} course={c} progress={learner?.enrolled.has(c.id) ? courseProgress(c, completed) : undefined} />)}</div>;

  let catalog;
  if (coursesQuery.isPending) catalog = <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <CourseCardSkeleton key={i} />)}</div>;
  else if (coursesQuery.isError) catalog = isNetworkError(coursesQuery.error) ? <NetworkErrorScreen compact onRetry={() => void coursesQuery.refetch()} /> : <ServerErrorScreen compact onRetry={() => void coursesQuery.refetch()} />;
  else if (courses.length === 0) catalog = <EmptyScreen compact title="Aucune formation pour l'instant" description="Le catalogue de votre campus est en préparation. Revenez bientôt !" />;
  else if (results.length === 0) catalog = <NoResultsScreen compact query={search.q} filtered={active > 0 || !!search.categorie} />;
  else catalog = grid(results);

  return (
    <div>
      <PageHeader kicker="Campus Academy" title="Apprenez à votre rythme" description="Des formations créées par des étudiants et des professionnels, avec certificat de réussite." breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Formations" }]} />
      <div className="mb-5 inline-flex rounded-lg bg-muted p-1" role="tablist" aria-label="Vue">
        {([["catalogue", "Catalogue"], ["mes", `Mes formations (${mine.length})`]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={vue === id} onClick={() => setSearch({ vue: id === "mes" ? "mes" : undefined })} className={cn("rounded-md px-4 py-2 text-sm font-semibold transition", vue === id ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground")}>{label}</button>
        ))}
      </div>

      {vue === "mes" ? (
        coursesQuery.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <CourseCardSkeleton key={i} />)}</div>
        ) : mine.length === 0 ? (
          <EmptyScreen compact title="Vous ne suivez aucune formation" description="Inscrivez-vous à une formation pour suivre votre progression ici." actions={<Button onClick={() => setSearch({ vue: undefined })}>Parcourir le catalogue</Button>} />
        ) : (
          <div className="space-y-8">
            {inProgress.length > 0 && (
              <section>
                <h2 className="mb-4 font-display text-lg font-bold">En cours</h2>
                <div className="grid gap-4 lg:grid-cols-2">
                  {inProgress.map((c) => {
                    const p = courseProgress(c, completed);
                    const next = nextModule(c, completed)?.id;
                    const Icon = c.icon;
                    return (
                      <article key={c.id} className="flex gap-4 rounded-xl border border-border bg-card p-4">
                        <span className={cn("grid size-20 shrink-0 place-items-center rounded-lg bg-gradient-to-br", c.tone)}><Icon className="size-9 text-primary" /></span>
                        <div className="min-w-0 flex-1">
                          <AppLink to={`/formations/${c.id}`} className="block truncate font-display font-bold hover:text-primary">{c.title}</AppLink>
                          <p className="mt-0.5 text-xs text-muted-foreground">{p.done}/{p.total} modules · reste {formatDuration(c.modules.filter((mod) => !completed.has(mod.id)).reduce((n, mod) => n + mod.minutes, 0))}</p>
                          <div className="mt-3 flex items-center gap-3"><ProgressBar pct={p.pct} className="flex-1" label={`Progression : ${c.title}`} /><span className="text-xs font-bold text-primary">{p.pct} %</span></div>
                          <Button asChild size="sm" className="mt-3"><AppLink to={next ? `/formations/${c.id}/modules/${next}` : `/formations/${c.id}`}>Continuer</AppLink></Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}
            {done.length > 0 && <section><h2 className="mb-4 font-display text-lg font-bold">Terminées</h2>{grid(done)}</section>}
          </div>
        )
      ) : (
        <>
          <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch({ q: qInput.trim() || undefined }); }}>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
              <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Rechercher une formation…" aria-label="Rechercher une formation" className="h-12 w-full rounded-lg border border-input bg-card pl-11 pr-10 text-base outline-none transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 md:text-sm" />
              {qInput && <button type="button" aria-label="Effacer la recherche" onClick={() => { setQInput(""); setSearch({ q: undefined }); }} className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button>}
            </div>
            <Button type="submit" size="lg" className="h-12 px-4 sm:px-5" aria-label="Rechercher"><Search className="sm:hidden" /><span className="hidden sm:inline">Rechercher</span></Button>
          </form>

          {resume && !search.q && !search.categorie && (
            <AppLink to={`/formations/${resume.id}/modules/${resumeNext?.id ?? resume.modules[0]?.id ?? ""}`} className="mt-5 flex items-center gap-4 rounded-xl border border-primary/25 bg-primary/5 p-4 transition hover:border-primary/50">
              <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary"><GraduationCap className="size-6" /></span>
              <span className="min-w-0 flex-1"><span className="block text-[11px] font-bold uppercase tracking-wider text-primary">Reprendre là où vous en étiez</span><span className="block truncate font-semibold">{resume.title}</span><ProgressBar pct={courseProgress(resume, completed).pct} className="mt-2 max-w-xs" label="Progression" /></span>
              <span className="hidden text-sm font-semibold text-primary sm:block">Continuer</span>
            </AppLink>
          )}

          <div className="no-scrollbar -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0" role="group" aria-label="Catégories">
            <button aria-pressed={!search.categorie} onClick={() => setSearch({ categorie: undefined })} className={cn("shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition", !search.categorie ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>Toutes</button>
            {categories.map(({ slug, name }) => { const Icon = styleOfCategory(slug).icon; return <button key={slug} aria-pressed={search.categorie === slug} onClick={() => setSearch({ categorie: slug })} className={cn("flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition", search.categorie === slug ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}><Icon className="size-4" />{name}</button>; })}
          </div>

          <div className="mt-6 grid gap-7 lg:grid-cols-[250px_1fr]">
            <aside className="hidden lg:block"><div className="sticky top-24 rounded-xl border border-border bg-card p-4"><p className="mb-4 flex items-center gap-2 font-display text-sm font-bold"><Filter className="size-4 text-primary" /> Filtres</p><CourseFilters value={filters} onChange={setFilters} /></div></aside>
            <div className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground" aria-live="polite"><span className="font-bold text-foreground">{coursesQuery.isSuccess ? results.length : 0}</span> formation{results.length > 1 ? "s" : ""}{search.q && <> pour « <span className="font-semibold text-foreground">{search.q}</span> »</>}</p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setSheet(true)}><Filter /> Filtres{active > 0 && <span className="ml-1 grid size-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{active}</span>}</Button>
                  <DropdownMenu open={sortOpen} onOpenChange={setSortOpen}>
                    <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Sort /> {triOptions.find((t) => t.id === tri)?.label}<ChevronDown className="size-4 opacity-60" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56"><DropdownMenuRadioGroup value={tri} onValueChange={(v) => setSearch({ tri: v === "populaires" ? undefined : (v as Tri) })}>{triOptions.map((t) => <DropdownMenuRadioItem key={t.id} value={t.id} className="cursor-pointer">{t.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              {catalog}
            </div>
          </div>
        </>
      )}

      <Drawer open={sheet} onOpenChange={setSheet}>
        <DrawerContent className="max-h-[88vh]">
          <DrawerHeader className="text-left"><DrawerTitle className="font-display">Filtres</DrawerTitle><DrawerDescription>Affinez le catalogue selon vos critères.</DrawerDescription></DrawerHeader>
          <div className="overflow-y-auto px-4 pb-2"><CourseFilters value={filters} onChange={setFilters} /></div>
          <DrawerFooter><Button size="lg" onClick={() => setSheet(false)}>Voir les {results.length} formations</Button></DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
