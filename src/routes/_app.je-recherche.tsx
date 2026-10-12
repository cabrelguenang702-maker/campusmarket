import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Coin, MessageCircle, Plus, Tag, UserSearch } from "@/components/icons";
import { LocationBadge, Pill } from "@/components/cm/badges";
import { Avatar, ProductCard, ProductCardSkeleton } from "@/components/cm/commerce";
import { InlineAlert, LoadingButtonLabel } from "@/components/cm/feedback";
import { Field, IconInput } from "@/components/cm/forms";
import { EmptyScreen, NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { categories, formatFcfa, type CategorySlug } from "@/lib/domain";
import { useMatchingListings, useSellerListings } from "@/lib/api/products";
import { useActiveCampuses } from "@/lib/api/geo";
import { useWanted, useWantedMutations, useWantedResponses, type WantedRequest } from "@/lib/api/wanted";
import { findOrCreateConversation } from "@/lib/api/engagement";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/je-recherche")({
  head: () => ({ meta: [{ title: "Je recherche — CampusMarket" }, { name: "description", content: "Publiez ce que vous cherchez et laissez les vendeurs de votre campus vous répondre." }] }),
  component: WantedPage,
});

type View = "liste" | "creer" | "resultats";
type Form = { titre: string; categorie: CategorySlug | ""; budget: string; description: string; campus: string };
const emptyForm: Form = { titre: "", categorie: "", budget: "", description: "", campus: "" };

/* ---------- Réponse d'un vendeur à une demande ---------- */

function RespondDialog({ request, open, onOpenChange }: { request: WantedRequest; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const mine = useSellerListings(userId, true);
  const { respond } = useWantedMutations();
  const [productId, setProductId] = useState<string>("aucune");
  const [message, setMessage] = useState("");
  const suitable = (mine.data ?? []).filter((p) => p.category === request.category);

  const send = () => {
    if (!userId) return;
    respond.mutate({ requestId: request.id, responderId: userId, productId: productId === "aucune" ? null : productId, message }, {
      onSuccess: () => { toast.success("Réponse envoyée", { description: `${request.author} est prévenu(e).` }); setMessage(""); setProductId("aucune"); onOpenChange(false); },
      onError: (e) => toast.error(friendlyError(e, "La réponse n'a pas pu être envoyée.")),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display">J'ai cet article</DialogTitle><DialogDescription>{request.title}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Field label="Annonce à proposer (facultatif)" htmlFor="resp-product" hint={suitable.length === 0 ? "Vous n'avez pas d'annonce publiée dans cette catégorie." : undefined}>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger id="resp-product" className="h-11 bg-card"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="aucune">Aucune, je réponds par message</SelectItem>{suitable.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {formatFcfa(p.price)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Votre message" htmlFor="resp-message"><Textarea id="resp-message" maxLength={1000} placeholder="Décrivez l'article, son état, où vous le remettez…" value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button disabled={message.trim().length < 2 || respond.isPending} onClick={send}>{respond.isPending ? "Envoi…" : "Envoyer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Réponses reçues (auteur de la demande) ---------- */

function ResponsesDialog({ request, open, onOpenChange }: { request: WantedRequest; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const responses = useWantedResponses(open ? request.id : undefined);

  const contact = async (responderId: string, productId: string | null) => {
    if (!session) return;
    try {
      const id = await findOrCreateConversation(session.user.id, responderId, productId ?? undefined);
      void navigate({ to: `/messages/${id}` as "/" });
    } catch (e) {
      toast.error(friendlyError(e, "Impossible d'ouvrir la conversation."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display">Réponses reçues</DialogTitle><DialogDescription>{request.title}</DialogDescription></DialogHeader>
        {responses.isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">Chargement…</p> : responses.isError ? <InlineAlert tone="danger" title="Impossible de charger les réponses">Réessayez dans un instant.</InlineAlert> : (responses.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Aucune réponse pour le moment.</p>
        ) : (
          <ul className="max-h-[60vh] space-y-3 overflow-y-auto">
            {responses.data!.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-3.5">
                <div className="flex items-center gap-2.5"><Avatar name={r.responder} size="sm" /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.responder}</span><span className="text-xs text-muted-foreground">{r.posted}</span></div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{r.message}</p>
                {r.productName && <p className="mt-2 text-xs font-semibold text-primary">Annonce proposée : {r.productName}</p>}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => void contact(r.responderId, r.productId)}><MessageCircle /> Écrire</Button>
                  {r.productId && <Button size="sm" variant="outline" onClick={() => void navigate({ to: `/produit/${r.productId}` as "/" })}>Voir l'annonce</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Carte d'une demande ---------- */

function RequestCard({ req, mine, onResults, fresh }: { req: WantedRequest; mine: boolean; onResults: () => void; fresh?: boolean }) {
  const category = categories.find((c) => c.slug === req.category);
  const open = req.status === "open";
  const { setStatus } = useWantedMutations();
  const [respondOpen, setRespondOpen] = useState(false);
  const [responsesOpen, setResponsesOpen] = useState(false);

  const close = (status: "fulfilled" | "closed") => setStatus.mutate({ id: req.id, status }, {
    onSuccess: () => toast.success(status === "fulfilled" ? "Demande marquée comme pourvue" : "Demande fermée"),
    onError: (e) => toast.error(friendlyError(e, "Impossible de modifier la demande.")),
  });

  return (
    <article className={cn("flex h-full flex-col rounded-xl border bg-card p-4 transition", fresh ? "border-primary/60 ring-2 ring-primary/15" : "border-border hover:border-primary/40")}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={open ? "success" : "neutral"}>{open ? "Ouverte" : "Pourvue"}</Pill>
        <Pill tone="primary">{category?.name}</Pill>
        {mine && <Pill tone="info">Ma demande</Pill>}
      </div>
      <h3 className="mt-3 font-display text-base font-bold leading-snug">{req.title}</h3>
      <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-muted-foreground">{req.description}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-lg font-bold text-primary">Budget : {formatFcfa(req.budget)}</span>
        <LocationBadge campus={req.campus} city={req.city} />
      </div>
      <div className="mt-auto" />
      <div className="mt-3 flex items-center gap-2.5 border-t border-border pt-3 text-xs text-muted-foreground"><Avatar name={req.author} size="sm" src={req.authorAvatarUrl} /><span className="min-w-0 flex-1 truncate"><span className="font-semibold text-foreground">{req.author}</span> · {req.posted}</span><span className="inline-flex items-center gap-1"><MessageCircle className="size-4" />{req.responses}</span></div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={onResults}>Voir les résultats</Button>
        {mine ? <Button size="sm" onClick={() => setResponsesOpen(true)}>Réponses ({req.responses})</Button> : <Button size="sm" disabled={!open} onClick={() => setRespondOpen(true)}>J'ai cet article</Button>}
      </div>
      {mine && open && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => close("fulfilled")}>Marquer pourvue</Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={setStatus.isPending} onClick={() => close("closed")}>Fermer</Button>
        </div>
      )}
      {!mine && <RespondDialog request={req} open={respondOpen} onOpenChange={setRespondOpen} />}
      {mine && <ResponsesDialog request={req} open={responsesOpen} onOpenChange={setResponsesOpen} />}
    </article>
  );
}

/* ---------- Page ---------- */

function WantedPage() {
  const { session, account } = useAuth();
  const userId = session?.user.id;
  const campusesQuery = useActiveCampuses();
  const campuses = campusesQuery.data ?? [];
  const { create } = useWantedMutations();

  const [view, setView] = useState<View>("liste");
  const [selected, setSelected] = useState<WantedRequest | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [filter, setFilter] = useState<CategorySlug | "toutes">("toutes");
  const [freshId, setFreshId] = useState<string | null>(null);

  const list = useWanted(filter === "toutes" ? undefined : filter);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const matches = useMatchingListings(view === "resultats" && selected ? { category: selected.category, budget: selected.budget, authorId: selected.authorId } : undefined);

  const profileCampus = account?.profile.campus ?? null;
  const defaultCampus = campuses.find((c) => c.shortName === profileCampus) ?? campuses[0];
  const campusShort = form.campus || defaultCampus?.shortName || "";
  const campusCity = campuses.find((c) => c.shortName === campusShort)?.city ?? account?.profile.city ?? "";

  const setField = <K extends keyof Form>(k: K, v: Form[K]) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };
  const budget = Number(form.budget.replace(/\D/g, ""));

  const submit = () => {
    const e: typeof errors = {};
    if (form.titre.trim().length < 5) e.titre = "Décrivez ce que vous cherchez en quelques mots (5 caractères minimum).";
    if (!form.categorie) e.categorie = "Choisissez une catégorie.";
    if (!budget) e.budget = "Indiquez votre budget maximum.";
    if (form.description.trim().length > 0 && form.description.trim().length < 10) e.description = "Ajoutez au moins 10 caractères, ou laissez vide.";
    if (!campusShort || !campusCity) e.campus = "Choisissez un campus.";
    setErrors(e);
    if (Object.keys(e).length || !userId || !form.categorie) return;
    create.mutate({ userId, input: { title: form.titre, description: form.description, budget, category: form.categorie, campus: campusShort, city: campusCity } }, {
      onSuccess: (id) => { setFreshId(id); setForm(emptyForm); setView("liste"); toast.success("Demande publiée", { description: "Les vendeurs concernés sont prévenus dès qu'une annonce correspond." }); },
      onError: (err) => toast.error(friendlyError(err, "Votre demande n'a pas pu être publiée.")),
    });
  };

  const header = <PageHeader kicker="Marketplace" title="Je recherche" description="Vous ne trouvez pas votre bonheur ? Publiez votre demande : les vendeurs de votre campus vous répondent." breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Marketplace", to: "/marketplace" }, { label: "Je recherche" }]} actions={view === "liste" ? <Button onClick={() => setView("creer")}><Plus /> Créer une demande</Button> : undefined} />;

  if (view === "creer") {
    return (
      <div>
        {header}
        <div className="max-w-xl">
          <button onClick={() => setView("liste")} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-[18px]" /> Retour aux demandes</button>
          <h2 className="font-display text-lg font-bold">Que recherchez-vous ?</h2>
          <div className="mt-5 space-y-5">
            <Field label="Titre de la demande" htmlFor="w-titre" error={errors.titre}><IconInput id="w-titre" icon={UserSearch} maxLength={120} placeholder="Ex. Ordinateur portable pour la programmation" value={form.titre} invalid={!!errors.titre} onChange={(e) => setField("titre", e.target.value)} /></Field>
            <Field label="Catégorie" htmlFor="w-cat" error={errors.categorie}><Select value={form.categorie} onValueChange={(v) => setField("categorie", v as CategorySlug)}><SelectTrigger id="w-cat" className={cn("h-11 bg-card", errors.categorie && "border-destructive")}><SelectValue placeholder="Choisir une catégorie" /></SelectTrigger><SelectContent>{categories.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Budget maximum (FCFA)" htmlFor="w-budget" error={errors.budget}><IconInput id="w-budget" icon={Coin} inputMode="numeric" placeholder="Ex. 250 000" value={budget ? budget.toLocaleString("fr-FR") : ""} invalid={!!errors.budget} onChange={(e) => setField("budget", e.target.value)} /></Field>
            <Field label="Précisions (facultatif)" htmlFor="w-desc" hint="Marque souhaitée, état minimum, délai…" error={errors.description}><Textarea id="w-desc" maxLength={2000} value={form.description} onChange={(e) => setField("description", e.target.value)} /></Field>
            <Field label="Campus" htmlFor="w-campus" error={errors.campus}><Select value={campusShort} onValueChange={(v) => setField("campus", v)} disabled={campuses.length === 0}><SelectTrigger id="w-campus" className="h-11 bg-card"><SelectValue placeholder={campusesQuery.isLoading ? "Chargement…" : "Choisir un campus"} /></SelectTrigger><SelectContent>{campuses.map((c) => <SelectItem key={c.shortName} value={c.shortName}>{c.shortName} · {c.city}</SelectItem>)}</SelectContent></Select></Field>
          </div>
          <Button size="lg" className="mt-6 w-full" disabled={create.isPending} onClick={submit}><LoadingButtonLabel loading={create.isPending} loadingText="Publication…">Publier ma demande</LoadingButtonLabel></Button>
        </div>
      </div>
    );
  }

  if (view === "resultats" && selected) {
    const found = matches.data ?? [];
    return (
      <div>
        {header}
        <button onClick={() => setView("liste")} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-[18px]" /> Retour aux demandes</button>
        <div className="mb-6 rounded-xl border border-primary/25 bg-primary/5 p-4"><p className="section-kicker">{selected.authorId === userId ? "Votre demande" : "Demande"}</p><h2 className="font-display text-lg font-bold">{selected.title}</h2><p className="mt-1 text-sm text-muted-foreground">Budget {formatFcfa(selected.budget)} · {categories.find((c) => c.slug === selected.category)?.name}</p></div>
        <h3 className="mb-4 font-display text-lg font-bold">{found.length > 0 ? `${found.length} annonce${found.length > 1 ? "s" : ""} correspondante${found.length > 1 ? "s" : ""}` : "Résultats correspondants"}</h3>
        {matches.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <ProductCardSkeleton key={i} />)}</div>
        ) : matches.isError ? (
          isNetworkError(matches.error) ? <NetworkErrorScreen compact onRetry={() => void matches.refetch()} /> : <ServerErrorScreen compact onRetry={() => void matches.refetch()} />
        ) : found.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{found.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        ) : (
          <EmptyScreen compact title="Aucune annonce ne correspond pour l'instant" description={selected.authorId === userId && selected.status === "open" ? "Pas besoin d'activer quoi que ce soit : vous êtes prévenu(e) automatiquement dès qu'un vendeur publie un article qui correspond à votre demande." : "Aucune annonce disponible dans cette catégorie et ce budget."} />
        )}
      </div>
    );
  }

  return (
    <div>
      {header}
      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrer par catégorie">
        {([["toutes", "Toutes"], ...categories.map((c) => [c.slug, c.name] as const)] as const).map(([slug, name]) => <button key={slug} aria-pressed={filter === slug} onClick={() => setFilter(slug as CategorySlug | "toutes")} className={cn("shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition", filter === slug ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{name}</button>)}
      </div>
      {list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <ProductCardSkeleton key={i} />)}</div>
      ) : list.isError ? (
        isNetworkError(list.error) ? <NetworkErrorScreen compact onRetry={() => void list.refetch()} /> : <ServerErrorScreen compact onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        filter === "toutes"
          ? <EmptyScreen compact title="Aucune demande pour l'instant" description="Soyez le premier à publier ce que vous cherchez sur votre campus." actions={<Button size="lg" onClick={() => setView("creer")}><Plus /> Créer une demande</Button>} />
          : <EmptyScreen compact title="Aucune demande dans cette catégorie" description="Publiez la première demande de cette catégorie." actions={<Button onClick={() => setView("creer")}><Tag /> Créer une demande</Button>} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map((r) => <RequestCard key={r.id} req={r} mine={r.authorId === userId} fresh={r.id === freshId} onResults={() => { setSelected(r); setView("resultats"); }} />)}</div>
          <div className="mt-8 flex flex-col items-center gap-2">
            <p className="text-xs text-muted-foreground">{items.length} sur {total} demandes affichées</p>
            {list.hasNextPage && <Button variant="outline" size="lg" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? "Chargement…" : "Afficher plus de demandes"}</Button>}
          </div>
        </>
      )}
    </div>
  );
}
