import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { CalendarDays, ChevronRight, Compass, GraduationCap, ShieldCheck, Store, Users } from "@/components/icons";
import heroImage from "@/assets/campus-market-hero.jpg";
import { AppLink } from "@/components/cm/app-link";
import { ProductCard, ProductCardSkeleton } from "@/components/cm/commerce";
import { SectionHeader } from "@/components/layout/PageHeader";
import { categories } from "@/lib/domain";
import { useCategoryCounts, useRecentListings } from "@/lib/api/products";

export const Route = createFileRoute("/_app/")({
  head: () => ({
    meta: [
      { title: "CampusMarket — Le campus africain qui échange" },
      { name: "description", content: "Achetez, vendez, apprenez et échangez au sein de votre communauté universitaire." },
      { property: "og:title", content: "CampusMarket — Le campus africain qui échange" },
      { property: "og:description", content: "La marketplace et la communauté des étudiants africains." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

const highlights = [
  { icon: Users, title: "Développeurs Cameroun", meta: "8 240 membres · 48 en ligne", to: "/communautes/developpeurs-cameroun" },
  { icon: CalendarDays, title: "Hackathon Campus 2026", meta: "Samedi · Université de Yaoundé I", to: "/evenements/hackathon-campus-2026" },
  { icon: GraduationCap, title: "Design UI avec Figma", meta: "Cours gratuit · 1 280 étudiants", to: "/formations/design-ui-figma" },
];

function HomePage() {
  const counts = useCategoryCounts().data;
  const recent = useRecentListings(6);
  return (
    <div>
      {/* Le hero garde toujours l'ambiance sombre de la marque, quel que soit le thème */}
      <section className="hero-panel dark relative min-h-[290px] overflow-hidden rounded-xl text-foreground">
        <img src={heroImage} alt="Produits et équipement pour étudiants" width={1200} height={800} className="absolute inset-0 h-full w-full object-cover" />
        <div className="hero-shade absolute inset-0" />
        <div className="relative z-10 flex min-h-[290px] max-w-xl flex-col justify-center p-6 sm:p-7 lg:p-10">
          <span className="mb-4 w-fit rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Conçu pour la vie étudiante</span>
          <h1 className="font-display text-3xl font-bold leading-tight sm:text-5xl">Le campus africain où l'on achète, vend, apprend et échange.</h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-foreground/70">Tout ce dont vous avez besoin pour réussir, à portée de campus.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg"><AppLink to="/marketplace"><Compass /> Explorer</AppLink></Button>
            <Button asChild size="lg" variant="outline" className="bg-background/40 backdrop-blur"><AppLink to="/publier"><Store /> Vendre un article</AppLink></Button>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <SectionHeader kicker="Explorer" title="Catégories populaires" action={<Button asChild variant="ghost" size="sm"><AppLink to="/marketplace">Voir tout <ChevronRight /></AppLink></Button>} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {categories.slice(0, 5).map(({ slug, name, icon: Icon }) => (
            <AppLink key={name} to="/marketplace" search={{ categorie: slug }} className="group rounded-lg border border-border bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-glow">
              <span className="mb-4 grid size-10 place-items-center rounded-md bg-accent text-primary"><Icon className="size-5" /></span>
              <p className="text-sm font-semibold">{name}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{counts ? `${counts[slug] ?? 0} annonce${(counts[slug] ?? 0) > 1 ? "s" : ""}` : "\u00a0"}</p>
            </AppLink>
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-7 xl:grid-cols-[1fr_340px]">
        <div>
          <SectionHeader kicker="Près de votre campus" title="Annonces récentes" action={<Button asChild variant="ghost" size="sm"><AppLink to="/marketplace">Voir tout <ChevronRight /></AppLink></Button>} />
          {recent.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <ProductCardSkeleton key={i} />)}</div>
          ) : recent.data && recent.data.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {recent.data.map((product) => <ProductCard key={product.id} product={product} />)}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="font-semibold">Aucune annonce pour le moment</p>
              <p className="mt-1 text-sm text-muted-foreground">Soyez le premier à vendre un article sur votre campus.</p>
              <Button asChild className="mt-4"><AppLink to="/publier"><Store /> Publier une annonce</AppLink></Button>
            </div>
          )}
        </div>
        <aside>
          <p className="section-kicker">La communauté bouge</p>
          <h2 className="font-display text-xl font-bold">À ne pas manquer</h2>
          <div className="mt-4 space-y-3">
            {highlights.map(({ icon: Icon, title, meta, to }) => (
              <AppLink key={title} to={to} className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition hover:border-primary/40">
                <span className="grid size-11 shrink-0 place-items-center rounded-md bg-accent text-primary"><Icon className="size-5" /></span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{title}</span>
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground">{meta}</span>
                </span>
                <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
              </AppLink>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-primary/20 bg-primary/10 p-4">
            <div className="flex items-center gap-2 text-primary"><ShieldCheck className="size-5" /><span className="text-sm font-semibold">Transactions sécurisées</span></div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Discutez, vérifiez le profil et payez en toute confiance.</p>
          </div>
        </aside>
      </section>
    </div>
  );
}
