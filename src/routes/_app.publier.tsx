import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertCircle, ArrowLeft, ArrowRight, Camera, Check, CheckCircle, Coin, Pencil, Plus, RefreshCw, Search, Share, Store, Tag, Trash, Upload } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { InlineAlert, LoadingButtonLabel, Spinner, StateScreen } from "@/components/cm/feedback";
import { Field, IconInput } from "@/components/cm/forms";
import { ProductCard } from "@/components/cm/commerce";
import { Stepper } from "@/components/cm/stepper";
import { QuantityStepper } from "@/components/marketplace/OrderSummary";
import { PageHeader } from "@/components/layout/PageHeader";
import { categories, conditions, formatFcfa, type CategorySlug, type Condition, type Product } from "@/lib/domain";
import { MAX_PHOTOS, createListing, updateListing, useCategoryPriceRange, useProduct, useProductMedia, type ProductMedia } from "@/lib/api/products";
import { useActiveCampuses } from "@/lib/api/geo";
import { friendlyError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/publier")({
  validateSearch: (s: Record<string, unknown>): { edit?: string | undefined } => ({ edit: typeof s["edit"] === "string" && /^[0-9a-f-]{36}$/i.test(s["edit"]) ? s["edit"] : undefined }),
  head: () => ({ meta: [{ title: "Publier une annonce — CampusMarket" }] }),
  component: PublishPage,
});

const steps = ["Informations", "Photos", "Caractéristiques", "Prix", "Aperçu"] as const;
const MAX_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Photo choisie sur l'appareil : validée (taille, format) tout de suite, envoyée à la publication. */
type Photo = { id: string; name: string; url: string; file?: File; media?: ProductMedia; state: "done" | "error"; reason?: "size" | "type" };
type Draft = {
  titre: string; categorie: CategorySlug | ""; description: string; photos: Photo[];
  etat: Condition; marque: string; quantite: number; specs: Record<string, string>;
  prix: string; prixBarre: string; negociable: boolean; campus: string; ville: string; duree: "15" | "30" | "60";
};
type Errors = Partial<Record<"titre" | "categorie" | "description" | "photos" | "prix" | "prixBarre", string>>;

const emptyDraft: Draft = { titre: "", categorie: "", description: "", photos: [], etat: "Bon état", marque: "", quantite: 1, specs: {}, prix: "", prixBarre: "", negociable: true, campus: "", ville: "", duree: "30" };

const specFields: Record<CategorySlug, string[]> = {
  ordinateurs: ["Processeur", "Mémoire", "Stockage"],
  telephones: ["Stockage", "Couleur", "Santé de la batterie"],
  audio: ["Connexion", "Autonomie"],
  livres: ["Niveau", "Filière"],
  services: ["Niveau", "Durée d'une séance"],
  mode: ["Taille", "Couleur"],
  maison: ["Dimensions"],
};

type View = 1 | 2 | 3 | 4 | 5 | "envoi" | "reussie" | "erreur";

const digits = (v: string) => v.replace(/\D/g, "");

function PublishPage() {
  const { edit } = Route.useSearch();
  const editing = edit !== undefined;
  const { account } = useAuth();
  const qc = useQueryClient();
  const campusesQuery = useActiveCampuses();
  const campuses = campusesQuery.data ?? [];
  const [view, setView] = useState<View>(1);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<Errors>({});
  const [published, setPublished] = useState<{ id: string; failedPhotos: number; status: "draft" | "pending_review" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const clearError = (key: keyof Errors) => setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft((d) => ({ ...d, [key]: value })); clearError(key as keyof Errors); };
  const price = Number(digits(draft.prix));
  const oldPrice = Number(digits(draft.prixBarre));

  /* ---------- Mode modification : préremplissage depuis l'annonce existante ---------- */
  const existing = useProduct(edit ?? "");
  const existingMedia = useProductMedia(edit);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [removedMedia, setRemovedMedia] = useState<ProductMedia[]>([]);
  useEffect(() => {
    const p = existing.data;
    if (!edit || !p || existingMedia.isLoading || loadedFor === edit) return;
    const specs: Record<string, string> = {};
    let marque = "";
    for (const [k, v] of p.specs) { if (k === "Marque") marque = v; else specs[k] = v; }
    setDraft({
      titre: p.name, categorie: p.category, description: p.description, etat: p.condition, marque, quantite: Math.max(p.quantity, 1), specs,
      prix: String(p.price), prixBarre: p.oldPrice ? String(p.oldPrice) : "", negociable: p.negotiable, campus: p.campus, ville: p.city, duree: "30",
      photos: (existingMedia.data ?? []).map((m, i) => ({ id: m.id, name: `Photo ${i + 1}`, url: m.url, media: m, state: "done" as const })),
    });
    setLoadedFor(edit);
  }, [edit, existing.data, existingMedia.isLoading, existingMedia.data, loadedFor]);

  // Campus par défaut : celui du profil s'il est actif, sinon le premier de la liste.
  const profileCampus = account?.profile.campus ?? null;
  const defaultCampus = campuses.find((c) => c.shortName === profileCampus) ?? campuses[0];
  const campusShort = draft.campus || defaultCampus?.shortName || "";
  const campusCity = campuses.find((c) => c.shortName === campusShort)?.city ?? (campusShort === profileCampus ? account?.profile.city ?? "" : "");

  /* ---------- Photos ---------- */
  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const room = MAX_PHOTOS - draft.photos.length;
    const next: Photo[] = Array.from(files).slice(0, Math.max(room, 0)).map((f, i) => {
      const reason = !ACCEPTED_TYPES.includes(f.type) ? "type" as const : f.size > MAX_SIZE ? "size" as const : undefined;
      return { id: `${Date.now()}-${i}`, name: f.name, url: URL.createObjectURL(f), file: f, state: reason ? "error" as const : "done" as const, ...(reason ? { reason } : {}) };
    });
    setDraft((d) => ({ ...d, photos: [...d.photos, ...next] }));
    clearError("photos");
    if (files.length > room) toast.warning(`Maximum ${MAX_PHOTOS} photos`, { description: "Les photos en trop n'ont pas été ajoutées." });
  };
  const removePhoto = (id: string) => setDraft((d) => {
    const gone = d.photos.find((p) => p.id === id);
    if (gone?.media) { const m = gone.media; setRemovedMedia((r) => [...r, m]); }
    else if (gone) URL.revokeObjectURL(gone.url);
    return { ...d, photos: d.photos.filter((p) => p.id !== id) };
  });

  /* ---------- Validation ---------- */
  const validate = (step: number): Errors => {
    const e: Errors = {};
    if (step === 1) {
      if (draft.titre.trim().length < 5) e.titre = "Le titre doit contenir au moins 5 caractères.";
      if (!draft.categorie) e.categorie = "Choisissez une catégorie.";
      if (draft.description.trim().length < 20) e.description = "Décrivez votre article en au moins 20 caractères.";
    }
    if (step === 2 && !draft.photos.some((p) => p.state === "done")) e.photos = "Ajoutez au moins une photo pour rassurer les acheteurs.";
    if (step === 4) {
      if (!price) e.prix = "Indiquez le prix de votre article.";
      if (oldPrice && oldPrice <= price) e.prixBarre = "L'ancien prix doit être supérieur au prix actuel.";
      if (!campusShort) e.prix = e.prix ?? "Choisissez le campus de remise.";
      if (price > 100_000_000) e.prix = "Ce prix semble trop élevé. Vérifiez le montant.";
    }
    return e;
  };
  const next = () => {
    const step = view as number;
    const e = validate(step);
    setErrors(e);
    if (Object.keys(e).length === 0) setView((step + 1) as View);
  };

  /* ---------- Aperçu ---------- */
  const category = categories.find((c) => c.slug === draft.categorie);
  const priceRange = useCategoryPriceRange(draft.categorie || undefined);
  const photos = draft.photos.filter((p) => p.state === "done");
  const preview: Product = {
    id: "apercu", name: draft.titre.trim() || "Titre de votre annonce", price: price || 0, ...(oldPrice > price && price ? { oldPrice } : {}),
    campus: campusShort, city: campusCity, condition: draft.etat, status: "pending_review", sellerId: account?.profile.id ?? "", sellerName: account?.profile.fullName ?? "Vous",
    sellerCampus: campusShort, sellerVerified: account?.profile.verified ?? false, sellerAvatarUrl: account?.profile.avatarUrl ?? null, rating: 0, reviews: 0, posted: "à l'instant", postedDays: 0, stock: "available",
    icon: category?.icon ?? Store, tone: category?.tone ?? "from-cyan-400/30 to-blue-700/20", category: draft.categorie || "ordinateurs", negotiable: draft.negociable, quantity: draft.quantite, description: draft.description,
    specs: [], views: 0, favorites: 0, images: photos.map((p) => p.url),
  };

  const buildSpecs = (): [string, string][] => {
    const entries: [string, string][] = [];
    if (draft.marque.trim()) entries.push(["Marque", draft.marque.trim()]);
    for (const [k, v] of Object.entries(draft.specs)) if (v.trim()) entries.push([k, v.trim()]);
    return entries;
  };

  const send = useMutation({
    mutationFn: async (status: "draft" | "pending_review") => {
      const userId = account?.profile.id;
      if (!userId) throw new Error("not-authenticated");
      if (!draft.categorie) throw new Error("categorie");
      if (!campusShort || !campusCity) throw new Error("campus");
      const listing = {
        name: draft.titre, description: draft.description, price, oldPrice: oldPrice > price ? oldPrice : undefined, quantity: draft.quantite, condition: draft.etat,
        negotiable: draft.negociable, category: draft.categorie, campus: campusShort, city: campusCity, specs: buildSpecs(), durationDays: Number(draft.duree) as 15 | 30 | 60,
      };
      if (edit) {
        const kept = photos.filter((p) => p.media).length;
        const r = await updateListing(userId, edit, listing, photos.flatMap((p) => (p.file ? [p.file] : [])), removedMedia, kept, status);
        return { id: edit, failedPhotos: r.failedPhotos };
      }
      return createListing(userId, listing, photos.flatMap((p) => (p.file ? [p.file] : [])), status);
    },
    onSuccess: (result, status) => {
      void qc.invalidateQueries({ queryKey: ["seller-listings"] });
      if (edit) { void qc.invalidateQueries({ queryKey: ["product", edit] }); void qc.invalidateQueries({ queryKey: ["listings"] }); }
      setPublished({ ...result, status });
      setView("reussie");
    },
    onError: (error) => {
      setView("erreur");
      toast.error(friendlyError(error, "Votre annonce n'a pas pu être publiée."));
    },
  });

  const publish = () => { setView("envoi"); send.mutate("pending_review"); };
  const saveDraft = () => { setView("envoi"); send.mutate("draft"); };
  const reset = () => { draft.photos.forEach((p) => { if (!p.media) URL.revokeObjectURL(p.url); }); setRemovedMedia([]); setDraft(emptyDraft); setPublished(null); setView(1); };

  const header = <PageHeader kicker="Vendre" title={editing ? "Modifier l'annonce" : "Publier une annonce"} description={editing ? "Votre annonce repasse en validation après modification : elle n'est plus visible des acheteurs pendant ce temps." : "Cinq étapes rapides pour mettre votre article en vente sur votre campus."} breadcrumbs={[{ label: "Accueil", to: "/" }, { label: editing ? "Modifier l'annonce" : "Publier une annonce" }]} />;

  /* ---------- Écrans de fin ---------- */
  if (editing) {
    if (existing.isError || existingMedia.isError) {
      return <div>{header}<StateScreen compact icon={Search} tone="danger" title="Impossible de charger l'annonce" description="Vérifiez votre connexion puis réessayez." actions={<Button onClick={() => { void existing.refetch(); void existingMedia.refetch(); }}>Réessayer</Button>} /></div>;
    }
    if (!existing.isLoading && (!existing.data || existing.data.sellerId !== account?.profile.id)) {
      return <div>{header}<StateScreen compact icon={Search} title="Annonce introuvable" description="Cette annonce n'existe pas ou ne vous appartient pas." actions={<Button asChild><AppLink to="/profil" search={{ onglet: "annonces" }}>Mes annonces</AppLink></Button>} /></div>;
    }
    if (loadedFor !== edit) return <div>{header}<div className="grid place-items-center py-16"><Spinner /></div></div>;
  }

  if (view === "envoi") {
    return <div>{header}<StateScreen icon={Upload} tone="primary" title="Envoi en cours…" description="Nous enregistrons votre annonce et vos photos. Ne fermez pas cette page." actions={<Spinner className="size-7" />} /></div>;
  }
  if (view === "reussie") {
    const isDraft = published?.status === "draft";
    return (
      <div>
        {header}
        <div className="mx-auto max-w-md">
          <StateScreen compact icon={CheckCircle} tone="success" title={isDraft ? "Brouillon enregistré" : "Annonce envoyée pour validation"} description={isDraft ? "Retrouvez-le dans « Mes annonces » pour le terminer et le publier plus tard." : "Un modérateur la vérifie avant sa mise en ligne. Vous serez notifié dès qu'elle est visible par les étudiants."} className="pt-2" />
          {published && published.failedPhotos > 0 && <InlineAlert tone="warning" className="mb-4" title={`${published.failedPhotos} photo(s) n'ont pas pu être envoyées`}>Votre annonce est enregistrée. Ouvrez « Mes annonces » pour réessayer d'ajouter ces photos.</InlineAlert>}
          <ProductCard product={preview} />
          <div className="mt-6 grid gap-2.5 sm:grid-cols-2"><Button asChild size="lg"><AppLink to="/profil/annonces">Voir mes annonces</AppLink></Button><Button size="lg" variant="outline" onClick={reset}><Plus /> Nouvelle annonce</Button></div>
          {published && <Button asChild variant="ghost" className="mt-2 w-full"><AppLink to={`/produit/${published.id}`}>Voir la fiche de l'annonce</AppLink></Button>}
        </div>
      </div>
    );
  }
  if (view === "erreur") {
    return (
      <div>
        {header}
        <StateScreen icon={AlertCircle} tone="danger" title="Publication impossible" description="Votre annonce n'a pas pu être enregistrée. Vos informations sont conservées, vous pouvez réessayer."
          actions={<><Button size="lg" onClick={publish}><RefreshCw /> Réessayer</Button><Button size="lg" variant="outline" onClick={saveDraft}>Enregistrer en brouillon</Button><Button size="lg" variant="ghost" onClick={() => setView(5)}>Modifier l'annonce</Button></>} />
      </div>
    );
  }

  const step = view;
  return (
    <div>
      {header}
      <Stepper steps={steps} current={step} className="mb-8 max-w-3xl" />

      <div className={cn("grid gap-8", step === 5 ? "lg:grid-cols-[1fr_340px]" : "")}>
        <div className="max-w-2xl min-w-0">
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="font-display text-lg font-bold">Décrivez votre article</h2>
              <Field label="Titre de l'annonce" htmlFor="pub-titre" error={errors.titre} hint="Soyez précis : marque, modèle, capacité."><IconInput id="pub-titre" icon={Tag} maxLength={70} placeholder="Ex. MacBook Air M2 13 pouces" value={draft.titre} invalid={!!errors.titre} onChange={(e) => set("titre", e.target.value)} /></Field>
              <Field label="Catégorie" htmlFor="pub-cat" error={errors.categorie}>
                <Select value={draft.categorie} onValueChange={(v) => set("categorie", v as CategorySlug)}><SelectTrigger id="pub-cat" aria-invalid={!!errors.categorie} className={cn("h-11 bg-card", errors.categorie && "border-destructive")}><SelectValue placeholder="Choisir une catégorie" /></SelectTrigger><SelectContent>{categories.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}</SelectContent></Select>
              </Field>
              <Field label="Description" htmlFor="pub-desc" error={errors.description} hint={`${draft.description.trim().length} / 20 caractères minimum`}><Textarea id="pub-desc" className={cn("min-h-32", errors.description && "border-destructive")} placeholder="État, accessoires inclus, raison de la vente, disponibilités pour la remise…" value={draft.description} onChange={(e) => set("description", e.target.value)} /></Field>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="font-display text-lg font-bold">Ajoutez des photos</h2>
              <p className="mt-1 text-sm text-muted-foreground">Une bonne première photo double les chances de vente. {draft.photos.length}/{MAX_PHOTOS} photos · 5 Mo maximum chacune.</p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {draft.photos.map((p, i) => (
                  <div key={p.id} className={cn("relative aspect-square overflow-hidden rounded-lg border bg-secondary", p.state === "error" ? "border-destructive/60" : "border-border")}>
                    <img src={p.url} alt={p.name} className="size-full object-cover" />
                    {i === 0 && p.state === "done" && <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">Photo principale</span>}
                    {p.state === "done" && <span className="absolute bottom-2 left-2 grid size-6 place-items-center rounded-full bg-success text-success-foreground"><Check className="size-4" /></span>}
                    {p.state === "error" && <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-destructive/15 p-2 text-center"><AlertCircle className="size-6 text-destructive" /><p className="text-[11px] font-semibold text-destructive">{p.reason === "size" ? "Fichier trop lourd" : "Format non pris en charge"}</p></div>}
                    <button aria-label={`Retirer ${p.name}`} onClick={() => removePhoto(p.id)} className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-background/90 text-muted-foreground hover:text-destructive"><Trash className="size-4" /></button>
                  </div>
                ))}
                {draft.photos.length < MAX_PHOTOS && (
                  <button type="button" onClick={() => fileRef.current?.click()} className={cn("flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-card text-center transition hover:border-primary/60 hover:bg-primary/5", errors.photos ? "border-destructive/60" : "border-input")}>
                    <span className="grid size-11 place-items-center rounded-full bg-accent text-primary"><Camera className="size-6" /></span>
                    <span className="text-xs font-semibold">Ajouter une photo</span>
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              {errors.photos && <p role="alert" className="mt-3 flex items-center gap-1.5 text-xs font-medium text-destructive"><AlertCircle className="size-3.5" />{errors.photos}</p>}
              {draft.photos.some((p) => p.state === "error") && <InlineAlert tone="warning" className="mt-4" title="Certaines photos ne peuvent pas être utilisées">Retirez-les et ajoutez-les de nouveau (JPG, PNG ou WebP, 5 Mo maximum).</InlineAlert>}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <h2 className="font-display text-lg font-bold">Caractéristiques</h2>
              <div>
                <Label className="mb-2 block text-[13px] font-semibold">État de l'article</Label>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="État de l'article">
                  {conditions.map((c) => <button key={c} role="radio" aria-checked={draft.etat === c} onClick={() => set("etat", c)} className={cn("rounded-full border px-4 py-2 text-sm font-semibold transition", draft.etat === c ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{c}</button>)}
                </div>
              </div>
              <Field label="Marque" htmlFor="pub-marque"><IconInput id="pub-marque" placeholder="Ex. Apple, Samsung, JBL" value={draft.marque} onChange={(e) => set("marque", e.target.value)} /></Field>
              {draft.categorie && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {specFields[draft.categorie].map((label) => <Field key={label} label={label} htmlFor={`pub-spec-${label}`}><IconInput id={`pub-spec-${label}`} value={draft.specs[label] ?? ""} onChange={(e) => set("specs", { ...draft.specs, [label]: e.target.value })} /></Field>)}
                </div>
              )}
              <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3.5"><div><p className="text-sm font-semibold">Quantité disponible</p><p className="text-xs text-muted-foreground">Nombre d'exemplaires à vendre</p></div><QuantityStepper value={draft.quantite} max={20} onChange={(v) => set("quantite", v)} /></div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <h2 className="font-display text-lg font-bold">Fixez votre prix</h2>
              <Field label="Prix (FCFA)" htmlFor="pub-prix" error={errors.prix}><IconInput id="pub-prix" icon={Coin} inputMode="numeric" placeholder="Ex. 450 000" value={price ? price.toLocaleString("fr-FR") : ""} invalid={!!errors.prix} onChange={(e) => set("prix", e.target.value)} /></Field>
              {category && priceRange.data && priceRange.data.count > 1 && <p className="-mt-2 text-xs text-muted-foreground">Annonces similaires : {formatFcfa(priceRange.data.min)} – {formatFcfa(priceRange.data.max)}</p>}
              <Field label="Ancien prix (facultatif)" htmlFor="pub-ancien" error={errors.prixBarre} hint="Il s'affichera barré pour montrer votre réduction."><IconInput id="pub-ancien" icon={Coin} inputMode="numeric" value={oldPrice ? oldPrice.toLocaleString("fr-FR") : ""} invalid={!!errors.prixBarre} onChange={(e) => set("prixBarre", e.target.value)} /></Field>
              <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3.5"><div><Label htmlFor="pub-nego" className="text-sm font-semibold">Prix négociable</Label><p className="text-xs text-muted-foreground">Les acheteurs pourront vous faire une offre</p></div><Switch id="pub-nego" checked={draft.negociable} onCheckedChange={(v) => set("negociable", v)} /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Campus de remise" htmlFor="pub-campus"><Select value={campusShort} onValueChange={(v) => set("campus", v)} disabled={campuses.length === 0}><SelectTrigger id="pub-campus" className="h-11 bg-card"><SelectValue placeholder={campusesQuery.isLoading ? "Chargement…" : "Choisir un campus"} /></SelectTrigger><SelectContent>{campuses.map((c) => <SelectItem key={c.shortName} value={c.shortName}>{c.shortName} · {c.city}</SelectItem>)}</SelectContent></Select></Field>
                <div><Label className="mb-2 block text-[13px] font-semibold">Durée de l'annonce</Label><div className="flex gap-2" role="radiogroup" aria-label="Durée">{(["15", "30", "60"] as const).map((d) => <button key={d} role="radio" aria-checked={draft.duree === d} onClick={() => set("duree", d)} className={cn("flex-1 rounded-md border py-2.5 text-sm font-semibold transition", draft.duree === d ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground")}>{d} jours</button>)}</div></div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div>
              <h2 className="font-display text-lg font-bold">Vérifiez votre annonce</h2>
              <p className="mt-1 text-sm text-muted-foreground">Relisez les informations avant de publier. Vous pourrez modifier l'annonce à tout moment.</p>
              <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-card text-sm">
                {([["Titre", draft.titre || "—", 1], ["Catégorie", category?.name ?? "—", 1], ["Photos", `${draft.photos.filter((p) => p.state === "done").length} photo(s)`, 2], ["État", draft.etat, 3], ["Quantité", String(draft.quantite), 3], ["Prix", price ? formatFcfa(price) : "—", 4], ["Négociable", draft.negociable ? "Oui" : "Non", 4], ["Remise", `${campusShort || "—"} · ${draft.duree} jours`, 4]] as const).map(([k, v, s]) => (
                  <div key={k} className="flex items-center justify-between gap-3 px-4 py-3"><span className="text-muted-foreground">{k}</span><span className="flex min-w-0 items-center gap-2 font-semibold"><span className="truncate">{v}</span><button aria-label={`Modifier ${k}`} onClick={() => setView(s as View)} className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary"><Pencil className="size-4" /></button></span></div>
                ))}
              </div>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">En publiant, vous confirmez que l'article vous appartient et respecte les règles de la plateforme.</p>
            </div>
          )}

          <div className={cn("mt-8 grid gap-2.5", step === 1 ? "grid-cols-1" : "grid-cols-[auto_1fr]")}>
            {step > 1 && <Button size="lg" variant="outline" onClick={() => { setErrors({}); setView((step - 1) as View); }}><ArrowLeft /> Retour</Button>}
            {step < 5 ? <Button size="lg" onClick={next}>Continuer <ArrowRight /></Button> : <Button size="lg" onClick={publish} disabled={send.isPending}><LoadingButtonLabel loading={send.isPending}>{editing ? "Enregistrer et renvoyer en validation" : "Envoyer pour validation"}</LoadingButtonLabel></Button>}
          </div>
        </div>

        {step === 5 && (
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Aperçu dans la marketplace</p>
            <ProductCard product={preview} />
          </aside>
        )}
      </div>
    </div>
  );
}
