import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ArrowRight, CalendarDays as CalendarIcon, Coin, MapPin, Pencil, Plus, Tag, Ticket, Trash, Users } from "@/components/icons";
import { InlineAlert, LoadingButtonLabel } from "@/components/cm/feedback";
import { Field, IconInput } from "@/components/cm/forms";
import { Stepper } from "@/components/cm/stepper";
import { EventCard } from "@/components/events/EventCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { friendlyError } from "@/lib/api/errors";
import { useEventActions, useEventCategories } from "@/lib/api/events";
import { useActiveCampuses } from "@/lib/api/geo";
import { useAuth } from "@/lib/auth";
import { formatFcfa } from "@/lib/domain";
import { dateLabel, displayStatus, styleOfEventCategory, type EventItem, type ProgramItem } from "@/lib/events-model";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/evenements/creer")({
  head: () => ({ meta: [{ title: "Créer un événement — CampusMarket" }] }),
  component: CreateEventPage,
});

const steps = ["Informations", "Lieu et date", "Billetterie", "Aperçu"] as const;

type Draft = {
  nom: string; categorie: string; description: string; organisateur: string;
  lieu: string; campus: string; ville: string; date: string; heure: string; fin: string; programme: ProgramItem[];
  gratuit: boolean; prix: string; capacite: string;
};
type Errors = Partial<Record<"nom" | "categorie" | "description" | "organisateur" | "lieu" | "campus" | "ville" | "date" | "heure" | "fin" | "prix" | "capacite", string>>;

const digits = (v: string) => v.replace(/\D/g, "");
const startsAtOf = (d: Draft) => (d.date && d.heure ? new Date(`${d.date}T${d.heure}`) : null);

function CreateEventPage() {
  const { session, account } = useAuth();
  const navigate = useNavigate();
  const actions = useEventActions(session?.user.id);
  const campusOptions = (useActiveCampuses().data ?? []).map((c) => c.shortName);
  const categories = useEventCategories().data ?? [];
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [draft, setDraft] = useState<Draft>({
    nom: "", categorie: "", description: "", organisateur: account?.profile.fullName ?? "", lieu: "", campus: account?.profile.campus ?? "", ville: account?.profile.city ?? "",
    date: "", heure: "", fin: "", programme: [], gratuit: true, prix: "", capacite: "",
  });
  const [errors, setErrors] = useState<Errors>({});

  const clearError = (key: keyof Errors) => setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft((d) => ({ ...d, [key]: value })); clearError(key as keyof Errors); };
  const price = Number(digits(draft.prix));
  const capacity = Number(digits(draft.capacite)) || 0;

  const validate = (s: number): Errors => {
    const e: Errors = {};
    if (s === 1) {
      if (draft.nom.trim().length < 3) e.nom = "Le nom doit contenir au moins 3 caractères.";
      if (!draft.categorie) e.categorie = "Choisissez une catégorie.";
      if (draft.description.trim().length < 20) e.description = "Décrivez votre événement en au moins 20 caractères.";
      if (draft.organisateur.trim().length < 2) e.organisateur = "Indiquez qui organise l'événement.";
    }
    if (s === 2) {
      if (!draft.lieu.trim()) e.lieu = "Indiquez le lieu de l'événement.";
      if (!draft.campus) e.campus = "Choisissez un campus.";
      if (!draft.ville.trim()) e.ville = "Indiquez la ville.";
      if (!draft.date) e.date = "Choisissez une date.";
      if (!draft.heure) e.heure = "Choisissez une heure.";
      const start = startsAtOf(draft);
      if (start && start.getTime() <= Date.now()) e.date = "L'événement doit avoir lieu dans le futur.";
      if (start && draft.fin) { const end = new Date(`${draft.date}T${draft.fin}`); if (end.getTime() <= start.getTime()) e.fin = "L'heure de fin doit suivre l'heure de début."; }
    }
    if (s === 3) {
      if (!draft.gratuit && !price) e.prix = "Indiquez le prix du billet.";
      if (!capacity) e.capacite = "Indiquez le nombre de places disponibles.";
    }
    return e;
  };
  const next = () => { const e = validate(step); setErrors(e); if (Object.keys(e).length === 0) setStep((step + 1) as 2 | 3 | 4); };

  const categoryName = categories.find((c) => c.slug === draft.categorie)?.name;
  const style = styleOfEventCategory(draft.categorie);
  const start = startsAtOf(draft);
  const preview: EventItem = {
    id: "apercu", name: draft.nom.trim() || "Nom de votre événement", category: categoryName ?? "Catégorie", categorySlug: draft.categorie, tone: style.tone, icon: style.icon,
    startsAt: start?.toISOString() ?? "", endsAt: null, dateLabel: start ? dateLabel(start.toISOString()) : "Date à définir", place: draft.lieu || "Lieu à définir", campus: draft.campus, city: draft.ville,
    organizer: draft.organisateur || "Vous", organizerSpaceId: null, createdBy: "", description: draft.description, price: draft.gratuit ? 0 : price, capacity, taken: 0, program: draft.programme,
    status: displayStatus({ dbStatus: "published", startsAt: start?.toISOString() ?? new Date(Date.now() + 86_400_000).toISOString(), endsAt: null, capacity: capacity || 1, taken: 0 }), dbStatus: "published",
  };

  const submit = (publish: boolean) => {
    if (!start) return;
    const end = draft.fin ? new Date(`${draft.date}T${draft.fin}`) : null;
    actions.create.mutate({
      name: draft.nom, description: draft.description, categorySlug: draft.categorie, venue: draft.lieu, campus: draft.campus, city: draft.ville,
      startsAt: start.toISOString(), endsAt: end ? end.toISOString() : null, capacity, price: draft.gratuit ? 0 : price, organizerName: draft.organisateur, program: draft.programme, publish,
    }, {
      onSuccess: (id) => { toast.success(publish ? "Votre événement est publié" : "Brouillon enregistré"); void navigate({ to: `/evenements/${id}` as "/" }); },
      onError: (e) => toast.error("Publication impossible", { description: friendlyError(e) }),
    });
  };

  const setProgram = (i: number, patch: Partial<ProgramItem>) => set("programme", draft.programme.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  return (
    <div>
      <PageHeader kicker="Organiser" title="Créer un événement" description="Quatre étapes pour publier votre événement et ouvrir la billetterie." breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Événements", to: "/evenements" }, { label: "Créer" }]} />
      <Stepper steps={steps} current={step} className="mb-8 max-w-2xl" />

      <div className={cn("grid gap-8", step === 4 ? "lg:grid-cols-[1fr_340px]" : "")}>
        <div className="max-w-2xl min-w-0">
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="font-display text-lg font-bold">Décrivez votre événement</h2>
              <Field label="Nom de l'événement" htmlFor="evt-nom" error={errors.nom} hint="Soyez clair et concis."><IconInput id="evt-nom" icon={Tag} maxLength={150} placeholder="Ex. Hackathon Campus 2026" value={draft.nom} invalid={!!errors.nom} onChange={(e) => set("nom", e.target.value)} /></Field>
              <Field label="Catégorie" htmlFor="evt-cat" error={errors.categorie}>
                <Select value={draft.categorie} onValueChange={(v) => set("categorie", v)}><SelectTrigger id="evt-cat" aria-invalid={!!errors.categorie} className={cn("h-11 bg-card", errors.categorie && "border-destructive")}><SelectValue placeholder="Choisir une catégorie" /></SelectTrigger><SelectContent>{categories.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}</SelectContent></Select>
              </Field>
              <Field label="Description" htmlFor="evt-desc" error={errors.description} hint={`${draft.description.trim().length} / 20 caractères minimum`}><Textarea id="evt-desc" className={cn("min-h-32", errors.description && "border-destructive")} maxLength={3000} placeholder="De quoi s'agit-il ? À qui s'adresse-t-il ?" value={draft.description} onChange={(e) => set("description", e.target.value)} /></Field>
              <Field label="Organisé par" htmlFor="evt-orga" error={errors.organisateur} hint="Le nom affiché sur la fiche : vous, un club, une association…"><IconInput id="evt-orga" icon={Users} maxLength={120} value={draft.organisateur} invalid={!!errors.organisateur} onChange={(e) => set("organisateur", e.target.value)} /></Field>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <h2 className="font-display text-lg font-bold">Où et quand ?</h2>
              <Field label="Lieu" htmlFor="evt-lieu" error={errors.lieu} hint="Salle, amphithéâtre ou adresse."><IconInput id="evt-lieu" icon={MapPin} placeholder="Ex. Amphithéâtre 200" value={draft.lieu} invalid={!!errors.lieu} onChange={(e) => set("lieu", e.target.value)} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Campus" htmlFor="evt-campus" error={errors.campus}><Select value={draft.campus} onValueChange={(v) => set("campus", v)}><SelectTrigger id="evt-campus" className={cn("h-11 bg-card", errors.campus && "border-destructive")}><SelectValue placeholder="Choisir" /></SelectTrigger><SelectContent>{campusOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field>
                <Field label="Ville" htmlFor="evt-ville" error={errors.ville}><IconInput id="evt-ville" maxLength={80} value={draft.ville} invalid={!!errors.ville} onChange={(e) => set("ville", e.target.value)} /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Date" htmlFor="evt-date" error={errors.date}><IconInput id="evt-date" icon={CalendarIcon} type="date" invalid={!!errors.date} value={draft.date} onChange={(e) => set("date", e.target.value)} /></Field>
                <Field label="Heure de début" htmlFor="evt-heure" error={errors.heure}><IconInput id="evt-heure" type="time" invalid={!!errors.heure} value={draft.heure} onChange={(e) => set("heure", e.target.value)} /></Field>
                <Field label="Heure de fin (facultatif)" htmlFor="evt-fin" error={errors.fin}><IconInput id="evt-fin" type="time" invalid={!!errors.fin} value={draft.fin} onChange={(e) => set("fin", e.target.value)} /></Field>
              </div>
              <div>
                <Label className="mb-2 block text-[13px] font-semibold">Programme (facultatif)</Label>
                <div className="space-y-2">
                  {draft.programme.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="time" aria-label="Heure" value={p.time} onChange={(e) => setProgram(i, { time: e.target.value })} className="h-11 w-28 shrink-0 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-primary" />
                      <input aria-label="Titre" placeholder="Ex. Accueil des participants" maxLength={120} value={p.title} onChange={(e) => setProgram(i, { title: e.target.value })} className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-primary" />
                      <Button type="button" variant="ghost" size="icon" aria-label="Retirer cette ligne" onClick={() => set("programme", draft.programme.filter((_, k) => k !== i))}><Trash /></Button>
                    </div>
                  ))}
                </div>
                {draft.programme.length < 20 && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => set("programme", [...draft.programme, { time: "", title: "" }])}><Plus /> Ajouter une ligne</Button>}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <h2 className="font-display text-lg font-bold">Configurez la billetterie</h2>
              <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3.5"><div><Label htmlFor="evt-gratuit" className="text-sm font-semibold">Événement gratuit</Label><p className="text-xs text-muted-foreground">Un billet gratuit est délivré à chaque inscription.</p></div><Switch id="evt-gratuit" checked={draft.gratuit} onCheckedChange={(v) => set("gratuit", v)} /></div>
              {!draft.gratuit && <Field label="Prix du billet (FCFA)" htmlFor="evt-prix" error={errors.prix}><IconInput id="evt-prix" icon={Coin} inputMode="numeric" placeholder="Ex. 1 000" value={price ? price.toLocaleString("fr-FR") : ""} invalid={!!errors.prix} onChange={(e) => set("prix", e.target.value)} /></Field>}
              <Field label="Nombre de places" htmlFor="evt-capacite" error={errors.capacite} hint="La billetterie se ferme automatiquement une fois complet."><IconInput id="evt-capacite" icon={Ticket} inputMode="numeric" placeholder="Ex. 120" value={capacity ? capacity.toLocaleString("fr-FR") : ""} invalid={!!errors.capacite} onChange={(e) => set("capacite", e.target.value)} /></Field>
              <InlineAlert tone="info">Le contrôle des billets à l'entrée se fait par scan du QR code depuis la page de l'événement, accessible à vous seul(e) en tant qu'organisateur.</InlineAlert>
              {!draft.gratuit && <InlineAlert tone="warning" title="Billets payants">Le prix ne pourra plus être modifié dès qu'un billet est émis. Les remboursements éventuels passent par le support CampusMarket.</InlineAlert>}
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 className="font-display text-lg font-bold">Vérifiez votre événement</h2>
              <p className="mt-1 text-sm text-muted-foreground">Relisez les informations avant de publier.</p>
              <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-card text-sm">
                {([["Nom", draft.nom || "—", 1], ["Catégorie", categoryName ?? "—", 1], ["Organisé par", draft.organisateur || "—", 1], ["Lieu", `${draft.lieu || "—"} · ${draft.campus}, ${draft.ville}`, 2], ["Date", start ? dateLabel(start.toISOString()) : "—", 2], ["Tarif", draft.gratuit ? "Gratuit" : formatFcfa(price), 3], ["Places", capacity ? String(capacity) : "—", 3]] as const).map(([k, v, target]) => (
                  <div key={k} className="flex items-center justify-between gap-3 px-4 py-3"><span className="text-muted-foreground">{k}</span><span className="flex min-w-0 items-center gap-2 font-semibold"><span className="truncate">{v}</span><button aria-label={`Modifier : ${k}`} onClick={() => setStep(target)} className="shrink-0 text-muted-foreground hover:text-primary"><Pencil className="size-4" /></button></span></div>
                ))}
              </div>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">En publiant, vous confirmez être responsable du bon déroulement de cet événement sur le campus.</p>
            </div>
          )}

          <div className={cn("mt-8 grid gap-2.5", step === 1 ? "grid-cols-1" : "grid-cols-[auto_1fr]")}>
            {step > 1 && <Button size="lg" variant="outline" disabled={actions.create.isPending} onClick={() => { setErrors({}); setStep((step - 1) as 1 | 2 | 3); }}><ArrowLeft /> Retour</Button>}
            {step < 4 ? <Button size="lg" onClick={next}>Continuer <ArrowRight /></Button> : <Button size="lg" disabled={actions.create.isPending} onClick={() => submit(true)}><LoadingButtonLabel loading={actions.create.isPending} loadingText="Publication…">Publier l'événement</LoadingButtonLabel></Button>}
          </div>
          {step === 4 && <Button size="lg" variant="ghost" className="mt-2 w-full" disabled={actions.create.isPending} onClick={() => submit(false)}>Enregistrer en brouillon (non visible)</Button>}
        </div>

        {step === 4 && (
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Aperçu dans le catalogue</p>
            <EventCard event={preview} />
          </aside>
        )}
      </div>
    </div>
  );
}
