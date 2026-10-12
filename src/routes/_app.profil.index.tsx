import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { BadgeCheck, Camera, Eye, Pencil, Settings, X } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { RatingStars, VerificationBadge } from "@/components/cm/badges";
import { Avatar, ProductCard, ProductCardSkeleton } from "@/components/cm/commerce";
import { InlineAlert } from "@/components/cm/feedback";
import { EditProfile, PersonalInfo, PhotoDialog } from "@/components/profile/ProfileEdit";
import { ProfileTabContent, profileTabs, type ProfileTab } from "@/components/profile/ProfileTabs";
import { PageHeader } from "@/components/layout/PageHeader";
import { useOwnStats } from "@/lib/api/profile";
import { useSellerListings, useSellerReviews } from "@/lib/api/products";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type Vue = "public" | "modifier" | "infos";
export type ProfileSearch = { onglet?: ProfileTab | undefined; vue?: Vue | undefined };

export const Route = createFileRoute("/_app/profil/")({
  validateSearch: (s: Record<string, unknown>): ProfileSearch => ({
    onglet: profileTabs.find((t) => t.id === s["onglet"])?.id,
    vue: (["public", "modifier", "infos"] as const).find((v) => v === s["vue"]),
  }),
  head: () => ({ meta: [{ title: "Mon profil — CampusMarket" }] }),
  component: ProfilePage,
});

function ProfileHeader({ onPhoto, publicView }: { onPhoto: () => void; publicView: boolean }) {
  const { account, session } = useAuth();
  const stats = useOwnStats(session?.user.id).data;
  const p = account?.profile;
  const studies = [p?.filiere, p?.niveau].filter(Boolean).join(", ");
  const subtitle = [p?.campus, studies].filter(Boolean).join(" · ");
  const place = [p?.city, p?.since].filter(Boolean).join(" · ");
  const values: [string, string][] = [
    ["Annonces", stats ? String(stats.listings) : "–"],
    ["Ventes", stats ? String(stats.sales) : "–"],
    ["Achats", stats ? String(stats.purchases) : "–"],
    ["Note", stats ? (stats.reviews > 0 ? stats.rating.toFixed(1).replace(".", ",") : "Aucun avis") : "–"],
  ];
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="brand-glow dot-grid h-24 bg-gradient-to-br from-primary/25 via-accent to-secondary sm:h-32" />
      <div className="px-4 pb-5 sm:px-6">
        <div className="-mt-10 flex flex-wrap items-end justify-between gap-3 sm:-mt-12">
          <div className="relative">
            <Avatar name={p?.fullName ?? ""} size="xl" src={p?.avatarUrl} className="ring-4 ring-card" />
            {!publicView && <button onClick={onPhoto} aria-label="Modifier la photo" className="absolute -bottom-1 -right-1 grid size-9 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow"><Camera className="size-[18px]" /></button>}
          </div>
          {!publicView && (
            <div className="flex flex-wrap gap-2">
              <Button asChild><AppLink to="/profil" search={{ vue: "modifier" }}><Pencil /> Modifier le profil</AppLink></Button>
              <Button asChild variant="outline"><AppLink to="/profil" search={{ vue: "public" }}><Eye /> Aperçu public</AppLink></Button>
              <Button asChild variant="ghost" size="icon" aria-label="Paramètres"><AppLink to="/profil/parametres"><Settings /></AppLink></Button>
            </div>
          )}
        </div>
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-2xl font-bold">{p?.fullName ?? "…"}</h2>{p?.verified && <VerificationBadge compact />}</div>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
          {p?.bio ? <p className="mt-3 max-w-2xl text-sm leading-6">{p.bio}</p> : !publicView && <p className="mt-3 text-sm text-muted-foreground">Ajoutez une courte présentation pour inspirer confiance. <AppLink to="/profil" search={{ vue: "modifier" }} className="font-semibold text-primary hover:underline">Compléter mon profil</AppLink></p>}
          {place && <p className="mt-2 text-xs text-muted-foreground">{place}</p>}
        </div>
        <dl className="mt-5 grid grid-cols-2 divide-x divide-y divide-border rounded-lg bg-secondary/60 sm:grid-cols-4 sm:divide-y-0">
          {values.map(([k, v]) => <div key={k} className="py-3 text-center"><dd className="font-display text-xl font-bold">{v}</dd><dt className="text-[11px] text-muted-foreground">{k}</dt></div>)}
        </dl>
        {!publicView && (
          <AppLink to="/profil/verification" className={cn("mt-4 flex items-center gap-3 rounded-lg border p-3 text-sm transition", p?.verified ? "border-primary/25 bg-primary/5 hover:border-primary/50" : "border-warning/40 bg-warning/10 hover:border-warning")}>
            <BadgeCheck className={cn("size-5", p?.verified ? "text-primary" : "text-warning")} />
            <span className="flex-1">{p?.verified ? <><span className="font-semibold">Compte vérifié</span><span className="text-muted-foreground"> · Étudiant{p.campus ? ` · ${p.campus}` : ""}</span></> : <><span className="font-semibold">Compte non vérifié</span><span className="text-muted-foreground"> · Faites vérifier votre statut d'étudiant</span></>}</span>
            <span className="text-xs font-semibold text-primary">{p?.verified ? "Détails" : "Vérifier"}</span>
          </AppLink>
        )}
      </div>
    </section>
  );
}

function PublicPreview({ go }: { go: (s: ProfileSearch) => void }) {
  const { session } = useAuth();
  const id = session?.user.id;
  const listings = useSellerListings(id, true);
  const reviews = useSellerReviews(id);
  return (
    <div>
      <PageHeader kicker="Mon espace" title="Aperçu de votre profil public" breadcrumbs={crumbs} />
      <InlineAlert tone="info" className="mb-4" title="Voici ce que voient les autres étudiants" action={<Button size="sm" variant="outline" className="shrink-0" onClick={() => go({})}><X /> Quitter l'aperçu</Button>}>Votre téléphone, votre e-mail et vos achats restent privés.</InlineAlert>
      <ProfileHeader onPhoto={() => {}} publicView />
      <h3 className="mb-4 mt-8 font-display text-lg font-bold">Annonces en ligne</h3>
      {listings.isPending ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <ProductCardSkeleton key={i} />)}</div>
        : (listings.data ?? []).length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Aucune annonce en ligne pour le moment.</p>
        : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{(listings.data ?? []).map((p) => <ProductCard key={p.id} product={p} />)}</div>}
      <h3 className="mb-4 mt-8 font-display text-lg font-bold">Avis reçus</h3>
      {(reviews.data ?? []).length === 0 && !reviews.isPending ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Aucun avis reçu pour le moment.</p>
        : <ul className="grid gap-3 lg:grid-cols-3">{(reviews.data ?? []).map((r) => <li key={r.id} className="rounded-xl border border-border bg-card p-4"><div className="flex items-center gap-3"><Avatar name={r.author} size="sm" /><span className="min-w-0 flex-1 text-sm font-semibold">{r.author}</span><RatingStars value={r.rating} /></div>{r.text && <p className="mt-3 text-sm leading-6 text-muted-foreground">{r.text}</p>}</li>)}</ul>}
    </div>
  );
}

const crumbs = [{ label: "Accueil", to: "/" }, { label: "Mon profil" }];

function ProfilePage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [photoOpen, setPhotoOpen] = useState(false);
  const tab: ProfileTab = search.onglet ?? "annonces";
  const go = (s: ProfileSearch) => void navigate({ search: s });

  if (search.vue === "modifier" || search.vue === "infos") {
    return (
      <div>
        <PageHeader kicker="Mon espace" title={search.vue === "modifier" ? "Modifier le profil" : "Informations personnelles"} breadcrumbs={crumbs} />
        {search.vue === "modifier" ? <EditProfile onPhoto={() => setPhotoOpen(true)} onDone={() => go({})} onInfos={() => go({ vue: "infos" })} /> : <PersonalInfo onDone={() => go({})} />}
        <PhotoDialog open={photoOpen} onOpenChange={setPhotoOpen} />
      </div>
    );
  }

  if (search.vue === "public") return <PublicPreview go={go} />;

  return (
    <div>
      <PageHeader kicker="Mon espace" title="Mon profil" breadcrumbs={crumbs} />
      <ProfileHeader onPhoto={() => setPhotoOpen(true)} publicView={false} />
      <div className="no-scrollbar -mx-4 mt-6 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0" role="tablist" aria-label="Mon activité">
        {profileTabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => go({ onglet: t.id })} className={cn("shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition", tab === t.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{t.label}</button>
        ))}
      </div>
      <div className="mt-5"><ProfileTabContent tab={tab} /></div>
      <PhotoDialog open={photoOpen} onOpenChange={setPhotoOpen} />
    </div>
  );
}
