import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Flag, Globe, Lock, Plus, Search, Share, Users, X } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Avatar } from "@/components/cm/commerce";
import { InlineAlert, Spinner, StateScreen } from "@/components/cm/feedback";
import { EmptyScreen, NetworkErrorScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { Composer } from "@/components/community/Composer";
import { CreateSpaceDialog } from "@/components/community/CreateSpaceDialog";
import { JoinButton } from "@/components/community/JoinButton";
import { MembersList } from "@/components/community/MembersList";
import { PostCard } from "@/components/community/PostCard";
import { PrivacyPill, SpaceCard, SpaceCardSkeleton } from "@/components/community/SpaceCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { submitReport } from "@/lib/api/engagement";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { statusIn, useFeed, useMyStates, useSpace, useSpaceCategories, useSpaceMembers, useSpaces } from "@/lib/api/spaces";
import { useAuth } from "@/lib/auth";
import { canModerate, isMember, kindLabels, memberLabel, roleLabel, type SpaceKind } from "@/lib/spaces-model";
import { cn } from "@/lib/utils";

/* Pages communes aux communautés et aux groupes : le `kind` décide des libellés et des chemins. */

export type SpacesSearch = { q?: string | undefined; categorie?: string | undefined };

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const feminine = (kind: SpaceKind) => kind === "communaute";

/* ------------------------------------------------------------------------------------------------ */
export function SpacesListPage({ kind, search, onSearch }: { kind: SpaceKind; search: SpacesSearch; onSearch: (patch: Partial<SpacesSearch>) => void }) {
  const label = kindLabels[kind];
  const { session } = useAuth();
  const query = useSpaces(kind);
  const states = useMyStates(session?.user.id).data;
  const categories = useSpaceCategories().data ?? [];
  const [qInput, setQInput] = useState(search.q ?? "");
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => { setQInput(search.q ?? ""); }, [search.q]);

  const spaces = query.data ?? [];
  const q = search.q ? normalize(search.q) : "";
  const results = spaces.filter((s) => (!search.categorie || s.categorySlug === search.categorie) && (!q || normalize(`${s.name} ${s.description} ${s.category}`).includes(q)));
  const usedSlugs = new Set(spaces.map((s) => s.categorySlug));
  const shownCategories = categories.filter((c) => usedSlugs.has(c.slug));
  const title = kind === "communaute" ? "Trouvez votre communauté" : "Trouvez votre groupe";
  const plural = label.many;

  let body;
  if (query.isPending) body = <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <SpaceCardSkeleton key={i} />)}</div>;
  else if (query.isError) body = isNetworkError(query.error) ? <NetworkErrorScreen compact onRetry={() => void query.refetch()} /> : <ServerErrorScreen compact onRetry={() => void query.refetch()} />;
  else if (spaces.length === 0) body = <EmptyScreen compact title={`Aucun${feminine(kind) ? "e" : ""} ${label.one} pour l'instant`} description={`Soyez le premier à créer ${label.article.toLowerCase()} ${label.one} pour votre campus.`} actions={<Button onClick={() => setCreateOpen(true)}><Plus /> Créer {label.article.toLowerCase()} {label.one}</Button>} />;
  else if (results.length === 0) body = <NoResultsScreen compact query={search.q} filtered={!!search.categorie} />;
  else body = <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{results.map((s) => <SpaceCard key={s.id} space={s} status={statusIn(states, s.id)} />)}</div>;

  return (
    <div>
      <PageHeader kicker={kind === "communaute" ? "Communautés" : "Groupes"} title={title} description={kind === "communaute" ? "Échangez avec des étudiants qui partagent vos passions et vos projets." : "Retrouvez votre classe, votre promotion ou votre équipe pour échanger et s'organiser."} breadcrumbs={[{ label: "Accueil", to: "/" }, { label: kind === "communaute" ? "Communautés" : "Groupes" }]}
        actions={<Button onClick={() => setCreateOpen(true)}><Plus /> Créer</Button>} />

      <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); onSearch({ q: qInput.trim() || undefined }); }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder={`Rechercher ${label.article.toLowerCase()} ${label.one}…`} aria-label={`Rechercher ${label.article.toLowerCase()} ${label.one}`} className="h-12 w-full rounded-lg border border-input bg-card pl-11 pr-10 text-base outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25" />
          {qInput && <button type="button" aria-label="Effacer la recherche" onClick={() => { setQInput(""); onSearch({ q: undefined }); }} className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"><X className="size-4" /></button>}
        </div>
        <Button type="submit" size="lg" className="h-12 px-4 sm:px-5" aria-label="Rechercher"><Search className="sm:hidden" /><span className="hidden sm:inline">Rechercher</span></Button>
      </form>

      {shownCategories.length > 0 && (
        <div className="no-scrollbar -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0" role="group" aria-label="Catégories">
          <button aria-pressed={!search.categorie} onClick={() => onSearch({ categorie: undefined })} className={cn("shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition", !search.categorie ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>Toutes</button>
          {shownCategories.map((c) => <button key={c.slug} aria-pressed={search.categorie === c.slug} onClick={() => onSearch({ categorie: c.slug })} className={cn("shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition", search.categorie === c.slug ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{c.name}</button>)}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><Globe className="size-3.5" /> Publique : ouverte à tous</span><span className="inline-flex items-center gap-1"><Lock className="size-3.5" /> Privée : sur demande</span></div>

      <p className="mb-4 mt-5 text-sm text-muted-foreground" aria-live="polite">{query.isSuccess && spaces.length > 0 && <><span className="font-bold text-foreground">{results.length}</span> {results.length > 1 ? plural : label.one}{search.q && <> pour « {search.q} »</>}</>}</p>
      {body}
      <CreateSpaceDialog kind={kind} open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
export function SpaceDetailPage({ kind, id }: { kind: SpaceKind; id: string }) {
  const label = kindLabels[kind];
  const { session } = useAuth();
  const userId = session?.user.id;
  const spaceQuery = useSpace(id);
  const space = spaceQuery.data;
  const statesQuery = useMyStates(userId);
  const status = statusIn(statesQuery.data, id);
  const member = isMember(status);
  const moderator = canModerate(status);
  const feed = useFeed(id, member);
  const members = useSpaceMembers(id, member);

  const crumbs = [{ label: "Accueil", to: "/" }, { label: kind === "communaute" ? "Communautés" : "Groupes", to: label.basePath }, { label: space?.name ?? (kind === "communaute" ? "Communauté" : "Groupe") }];
  const header = <PageHeader title="" className="mb-4 [&_h1]:hidden" breadcrumbs={crumbs} />;

  if (spaceQuery.isPending || (statesQuery.isPending && !!userId)) {
    return <div>{header}<div className="space-y-4" aria-busy><div className="h-52 animate-pulse rounded-xl bg-foreground/10" /><div className="grid gap-6 lg:grid-cols-[1fr_300px]"><div className="space-y-4"><div className="h-20 animate-pulse rounded-xl bg-foreground/10" /><div className="h-48 animate-pulse rounded-xl bg-foreground/10" /></div><div className="h-48 animate-pulse rounded-xl bg-foreground/10" /></div></div></div>;
  }
  if (spaceQuery.isError) return <div>{header}{isNetworkError(spaceQuery.error) ? <NetworkErrorScreen compact onRetry={() => void spaceQuery.refetch()} /> : <ServerErrorScreen compact onRetry={() => void spaceQuery.refetch()} />}</div>;
  if (!space || space.kind !== kind) {
    return <div>{header}<StateScreen icon={Search} title={`${kind === "communaute" ? "Communauté" : "Groupe"} introuvable`} description={`Ce${feminine(kind) ? "tte" : ""} ${label.one} n'existe pas ou n'est plus disponible.`} actions={<Button asChild size="lg"><AppLink to={label.basePath}>Voir les {label.many}</AppLink></Button>} /></div>;
  }

  const Icon = space.icon;
  const posts = (feed.data?.pages ?? []).flatMap((p) => p.posts);
  const leaders = (members.data ?? []).filter((m) => m.role !== "member").slice(0, 5);

  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast.success("Lien copié"); }
    catch { toast.error("Copie impossible", { description: "Copiez l'adresse depuis la barre du navigateur." }); }
  };
  const report = async () => {
    if (!userId) return;
    try { await submitReport({ reporterId: userId, targetType: "space", targetId: space.id, reason: "Contenu inapproprié", details: "" }); toast.info("Signalement envoyé", { description: "Notre équipe va examiner cet espace." }); }
    catch (e) { toast.error("Signalement impossible", { description: friendlyError(e) }); }
  };

  return (
    <div>
      {header}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className={`brand-glow dot-grid relative h-28 bg-gradient-to-br sm:h-36 ${space.tone}`} />
        <div className="px-4 pb-5 sm:px-6">
          <div className="-mt-10 flex flex-wrap items-end justify-between gap-3 sm:-mt-12">
            <span className="grid size-20 place-items-center rounded-2xl border-4 border-card bg-secondary text-primary sm:size-24"><Icon className="size-9 sm:size-10" /></span>
            <div className="flex flex-wrap gap-2">
              <JoinButton space={space} status={status} />
              <Button variant="ghost" size="icon" aria-label={`Partager ${label.the}`} onClick={() => void share()}><Share /></Button>
              {!member && <Button variant="ghost" size="icon" aria-label={`Signaler ${label.the}`} onClick={() => void report()}><Flag /></Button>}
            </div>
          </div>
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2"><h1 className="font-display text-2xl font-bold">{space.name}</h1><PrivacyPill privacy={space.privacy} /></div>
            <p className="mt-1 text-sm text-muted-foreground">{space.category} · {memberLabel(space.memberCount)} · {space.createdAt}</p>
            <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm leading-6">{space.description}</p>
          </div>
          {(member || space.privacy === "publique") && <div className="mt-4 flex flex-wrap gap-3 text-sm"><AppLink to={`${label.basePath}/${space.id}/membres`} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"><Users className="size-4" /> {member && moderator ? "Gérer les membres" : "Voir les membres"}</AppLink></div>}
        </div>
      </section>

      {!member ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="rounded-xl border border-border bg-card"><StateScreen compact icon={Lock} tone="neutral" title="Publications réservées aux membres"
            description={status === "attente" ? "Votre demande est en attente : un administrateur doit la valider." : space.privacy === "publique" ? `Rejoignez ${label.the} pour voir les publications et participer.` : `Demandez à rejoindre ${label.the} : un administrateur validera votre demande.`}
            actions={space.privacy !== "invitation" ? <JoinButton space={space} status={status} size="lg" /> : undefined} /></div>
          {space.rules.length > 0 && <aside className="lg:self-start"><section className="rounded-xl border border-border bg-card p-4"><h2 className="font-display text-sm font-bold">Règles</h2><ol className="mt-3 space-y-2 text-sm text-muted-foreground">{space.rules.map((r, i) => <li key={i} className="flex gap-2.5"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/12 text-[11px] font-bold text-primary">{i + 1}</span>{r}</li>)}</ol></section></aside>}
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0 space-y-4">
            <Composer spaceId={space.id} />
            {moderator && <InlineAlert tone="info" title={`Vous modérez ${label.the}`}>Épinglez ou supprimez une publication depuis son menu ⋯, et gérez les membres depuis la page « Membres ».</InlineAlert>}
            {feed.isPending ? <div className="space-y-4" aria-busy>{[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-foreground/10" />)}</div>
              : feed.isError ? (isNetworkError(feed.error) ? <NetworkErrorScreen compact onRetry={() => void feed.refetch()} /> : <ServerErrorScreen compact onRetry={() => void feed.refetch()} />)
              : posts.length === 0 ? <StateScreen compact icon={Users} title="Aucune publication" description="Lancez la conversation : publiez la première !" />
              : <>
                  {posts.map((post) => <PostCard key={post.id} post={post} canModerate={moderator} />)}
                  {feed.hasNextPage && <div className="grid place-items-center pt-2"><Button variant="outline" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>{feed.isFetchingNextPage ? <Spinner className="size-4" /> : "Voir plus de publications"}</Button></div>}
                </>}
          </div>
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            {space.rules.length > 0 && <section className="rounded-xl border border-border bg-card p-4"><h2 className="font-display text-sm font-bold">Règles</h2><ol className="mt-3 space-y-2 text-sm text-muted-foreground">{space.rules.map((r, i) => <li key={i} className="flex gap-2.5"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/12 text-[11px] font-bold text-primary">{i + 1}</span>{r}</li>)}</ol></section>}
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="font-display text-sm font-bold">Responsables</h2>
              {leaders.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">{members.isPending ? "Chargement…" : "Aucun responsable à afficher."}</p>
                : <ul className="mt-3 space-y-2.5">{leaders.map((m) => <li key={m.userId} className="flex items-center gap-2.5"><Avatar name={m.name} size="sm" src={m.avatarUrl} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{m.name}</span><span className="block text-[11px] text-muted-foreground">{roleLabel[m.role]}</span></span></li>)}</ul>}
              <Button asChild variant="outline" size="sm" className="mt-3 w-full"><AppLink to={`${label.basePath}/${space.id}/membres`}>Voir tous les membres</AppLink></Button>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
export function SpaceMembersPage({ kind, id }: { kind: SpaceKind; id: string }) {
  const label = kindLabels[kind];
  const { session } = useAuth();
  const spaceQuery = useSpace(id);
  const space = spaceQuery.data;
  const statesQuery = useMyStates(session?.user.id);
  const status = statusIn(statesQuery.data, id);
  const crumbs = [{ label: "Accueil", to: "/" }, { label: kind === "communaute" ? "Communautés" : "Groupes", to: label.basePath }, { label: space?.name ?? (kind === "communaute" ? "Communauté" : "Groupe"), to: space ? `${label.basePath}/${space.id}` : label.basePath }, { label: "Membres" }];
  const header = <PageHeader kicker={kind === "communaute" ? "Communauté" : "Groupe"} title="Membres" breadcrumbs={crumbs} />;

  if (spaceQuery.isPending || (statesQuery.isPending && !!session)) return <div>{header}<div className="max-w-2xl space-y-2" aria-busy>{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-foreground/10" />)}</div></div>;
  if (spaceQuery.isError) return <div>{header}{isNetworkError(spaceQuery.error) ? <NetworkErrorScreen compact onRetry={() => void spaceQuery.refetch()} /> : <ServerErrorScreen compact onRetry={() => void spaceQuery.refetch()} />}</div>;
  if (!space || space.kind !== kind) return <div>{header}<StateScreen icon={Search} title={`${kind === "communaute" ? "Communauté" : "Groupe"} introuvable`} description={`Impossible d'afficher les membres de ce${feminine(kind) ? "tte" : ""} ${label.one}.`} actions={<Button asChild size="lg"><AppLink to={label.basePath}>Retour à la liste</AppLink></Button>} /></div>;
  if (space.privacy !== "publique" && !isMember(status)) {
    return <div>{header}<div className="max-w-2xl rounded-xl border border-border bg-card"><StateScreen compact icon={Lock} title="Liste réservée aux membres" description={`Rejoignez ${label.the} pour voir ses membres.`} actions={<Button asChild><AppLink to={`${label.basePath}/${space.id}`}>Retour à {label.the}</AppLink></Button>} /></div></div>;
  }
  return <div>{header}<div className="max-w-2xl"><MembersList space={space} myStatus={status} /></div></div>;
}
