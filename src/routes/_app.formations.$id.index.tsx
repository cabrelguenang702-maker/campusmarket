import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, BookOpen, Certificate, Check, CheckCircle, Clock, Layers, Lock, Play, Search, Smartphone, Star, Trophy, Users, Video, Article, File } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill, RatingStars } from "@/components/cm/badges";
import { Avatar } from "@/components/cm/commerce";
import { InlineAlert, LoadingButtonLabel, StateScreen } from "@/components/cm/feedback";
import { NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { EnrollDialog } from "@/components/academy/EnrollDialog";
import { LevelPill, PriceTag, ProgressBar } from "@/components/academy/CourseCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { courseMinutes, courseProgress, formatDuration, isModuleOpen, kindMeta, nextModule, updatedLabel, type ModuleKind } from "@/lib/academy-model";
import { useAcademyActions, useCourse, useCourseReviews, useLearner, useSaveReview } from "@/lib/api/academy";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { timeAgo } from "@/lib/domain";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/formations/$id/")({
  head: () => ({ meta: [{ title: "Formation — Campus Academy" }] }),
  component: CoursePage,
});

type Tab = "presentation" | "modules" | "avis";

const kindIcon: Record<ModuleKind, typeof Video> = { video: Video, pdf: File, article: Article };

/** Formulaire d'avis (une personne inscrite ; un seul avis par formation, modifiable). */
function ReviewForm({ courseId, userId, mine }: { courseId: string; userId: string; mine?: { rating: number; text: string } | undefined }) {
  const save = useSaveReview(courseId, userId);
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [text, setText] = useState(mine?.text ?? "");
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="font-display text-base font-bold">{mine ? "Modifier votre avis" : "Donnez votre avis"}</h3>
      <div className="mt-2 flex items-center gap-1" role="radiogroup" aria-label="Note">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} sur 5`} onClick={() => setRating(n)} className="rounded p-0.5">
            <Star {...(n <= rating ? { pack: "filled" as const } : {})} className={cn("size-7", n <= rating ? "text-warning" : "text-muted-foreground")} />
          </button>
        ))}
      </div>
      <Textarea className="mt-3" maxLength={1000} placeholder="Qu'avez-vous pensé de cette formation ? (facultatif)" value={text} onChange={(e) => setText(e.target.value)} />
      <Button className="mt-3" disabled={rating < 1 || save.isPending} onClick={() => save.mutate({ rating, text }, { onSuccess: () => toast.success("Merci pour votre avis"), onError: (e) => toast.error("Avis non enregistré", { description: friendlyError(e) }) })}>
        <LoadingButtonLabel loading={save.isPending} loadingText="Envoi…">{mine ? "Mettre à jour" : "Publier mon avis"}</LoadingButtonLabel>
      </Button>
    </section>
  );
}

function CoursePage() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const userId = session?.user.id;
  const courseQuery = useCourse(id);
  const course = courseQuery.data;
  const learner = useLearner(userId).data;
  const actions = useAcademyActions(userId);
  const reviewsQuery = useCourseReviews(id);
  const [tab, setTab] = useState<Tab>("presentation");
  const [enrollOpen, setEnrollOpen] = useState(false);
  const crumbs = [{ label: "Accueil", to: "/" }, { label: "Formations", to: "/formations" }, { label: course?.title ?? "Formation" }];
  const bare = <PageHeader title="" className="mb-4 [&_h1]:hidden" breadcrumbs={crumbs} />;

  if (courseQuery.isPending) {
    return <div>{bare}<div className="space-y-4" aria-busy><div className="h-56 animate-pulse rounded-xl bg-foreground/10" /><div className="grid gap-6 lg:grid-cols-[1fr_340px]"><div className="h-72 animate-pulse rounded-xl bg-foreground/10" /><div className="h-72 animate-pulse rounded-xl bg-foreground/10" /></div></div></div>;
  }
  if (courseQuery.isError) return <div>{bare}{isNetworkError(courseQuery.error) ? <NetworkErrorScreen compact onRetry={() => void courseQuery.refetch()} /> : <ServerErrorScreen compact onRetry={() => void courseQuery.refetch()} />}</div>;
  if (!course) {
    return <div>{bare}<StateScreen icon={Search} title="Formation introuvable" description="Cette formation n'existe pas ou n'est plus disponible." actions={<Button asChild size="lg"><AppLink to="/formations">Voir le catalogue</AppLink></Button>} /></div>;
  }

  /* ---------- Statut et progression ---------- */
  const completedSet = learner?.completed ?? new Set<string>();
  const total = course.modules.length;
  const prog = courseProgress(course, completedSet);
  const enrolled = learner?.enrolled.has(course.id) ?? false;
  const status: "non" | "cours" | "terminee" = !enrolled ? "non" : prog.complete ? "terminee" : "cours";
  const completed = course.modules.filter((m) => completedSet.has(m.id)).map((m) => m.id);
  const pct = prog.pct;
  const first = course.modules[0];
  const next = nextModule(course, completedSet) ?? first;
  const remaining = course.modules.filter((m) => !completedSet.has(m.id)).reduce((n, m) => n + m.minutes, 0);
  const previewModule = course.modules.find((m) => m.preview);
  const reviews = reviewsQuery.data ?? [];
  const myReview = reviews.find((r) => r.userId === userId);

  const cta = status === "non" ? (
    <>
      <Button size="lg" className="w-full" onClick={() => setEnrollOpen(true)}>{learner?.pending.has(course.id) ? "Reprendre le paiement" : course.price === 0 ? "S'inscrire gratuitement" : "S'inscrire à la formation"}</Button>
      {previewModule && <Button asChild size="lg" variant="outline" className="w-full"><AppLink to={`/formations/${course.id}/modules/${previewModule.id}`}><Play /> Voir un aperçu gratuit</AppLink></Button>}
    </>
  ) : status === "cours" ? (
    <Button asChild size="lg" className="w-full"><AppLink to={`/formations/${course.id}/modules/${next?.id ?? ""}`}>Continuer la formation <ArrowRight /></AppLink></Button>
  ) : (
    <>
      <Button asChild size="lg" className="w-full"><AppLink to={`/formations/${course.id}/certificat`}><Certificate /> Voir mon certificat</AppLink></Button>
      <Button asChild size="lg" variant="outline" className="w-full"><AppLink to={`/formations/${course.id}/modules/${first?.id ?? ""}`}>Revoir la formation</AppLink></Button>
    </>
  );

  const Icon = course.icon;
  return (
    <div>
      {bare}

      {/* Bandeau */}
      <section className={cn("dark relative overflow-hidden rounded-xl bg-gradient-to-br p-6 text-foreground sm:p-8", course.tone, "bg-background")}>
        <div className={cn("absolute inset-0 bg-gradient-to-br opacity-80", course.tone)} />
        <div className="dot-grid absolute inset-0 opacity-30" />
        <div className="relative max-w-3xl">
          <div className="flex flex-wrap items-center gap-2"><Pill tone="primary">{course.category}</Pill><LevelPill level={course.level} /></div>
          <h1 className="mt-3 font-display text-3xl font-bold leading-tight sm:text-4xl">{course.title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground/80 sm:text-base">{course.tagline}</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-foreground/80">
            <span className="inline-flex items-center gap-1.5"><Star pack="filled" className="size-4 text-warning" />{course.reviews > 0 ? <><b className="text-foreground">{course.rating.toString().replace(".", ",")}</b> ({course.reviews} avis)</> : "Pas encore d'avis"}</span>
            <span className="inline-flex items-center gap-1.5"><Users className="size-4" />{course.students.toLocaleString("fr-FR")} étudiant{course.students > 1 ? "s" : ""}</span>
            <span className="inline-flex items-center gap-1.5"><Clock className="size-4" />{formatDuration(courseMinutes(course))}</span>
            <span className="inline-flex items-center gap-1.5"><Layers className="size-4" />{total} modules</span>
          </div>
          <div className="mt-5 flex items-center gap-3"><Avatar name={course.instructor.name} size="md" /><span className="text-sm"><span className="block font-semibold">{course.instructor.name}</span><span className="block text-xs text-foreground/70">{course.instructor.role}</span></span></div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Colonne principale */}
        <div className="min-w-0 space-y-6">
          {status !== "non" && (
            <section className="rounded-xl border border-border bg-card p-5" aria-label="Votre progression">
              <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-display text-base font-bold">Votre progression</h2>{status === "terminee" ? <Pill tone="success" icon={CheckCircle}>Terminée</Pill> : <Pill tone="primary">En cours</Pill>}</div>
              <div className="mt-3 flex items-center gap-3"><ProgressBar pct={pct} className="h-3 flex-1" label="Progression de la formation" /><span className="font-display text-lg font-bold text-primary">{pct} %</span></div>
              <p className="mt-2 text-xs text-muted-foreground">{completed.length} module{completed.length > 1 ? "s" : ""} sur {total} terminé{completed.length > 1 ? "s" : ""}{status === "cours" && <> · il vous reste environ {formatDuration(remaining)}</>}</p>
              {status === "terminee" && <InlineAlert tone="success" className="mt-4" title="Félicitations, vous avez terminé cette formation !" action={<Button asChild size="sm" className="shrink-0"><AppLink to={`/formations/${course.id}/certificat`}>Mon certificat</AppLink></Button>}>Votre certificat de réussite est disponible.</InlineAlert>}
            </section>
          )}

          <div className="inline-flex rounded-lg bg-muted p-1" role="tablist" aria-label="Sections de la formation">
            {([["presentation", "Présentation"], ["modules", `Modules (${total})`], ["avis", `Avis (${course.reviews})`]] as const).map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-md px-4 py-2 text-sm font-semibold transition", tab === t ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground")}>{l}</button>)}
          </div>

          {tab === "presentation" && (
            <div className="space-y-6">
              <section className="rounded-xl border border-border bg-card p-5"><h2 className="font-display text-lg font-bold">À propos de cette formation</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">{course.description}</p></section>
              {course.learn.length > 0 && <section className="rounded-xl border border-border bg-card p-5"><h2 className="font-display text-lg font-bold">Ce que vous apprendrez</h2><ul className="mt-3 grid gap-2.5 sm:grid-cols-2">{course.learn.map((l) => <li key={l} className="flex gap-2.5 text-sm"><Check className="mt-0.5 size-5 shrink-0 text-success" />{l}</li>)}</ul></section>}
              {course.requirements.length > 0 && <section className="rounded-xl border border-border bg-card p-5"><h2 className="font-display text-lg font-bold">Prérequis</h2><ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">{course.requirements.map((r) => <li key={r}>{r}</li>)}</ul></section>}
              <section className="rounded-xl border border-border bg-card p-5"><h2 className="font-display text-lg font-bold">Votre formateur</h2><div className="mt-3 flex gap-4"><Avatar name={course.instructor.name} size="lg" /><div><p className="font-semibold">{course.instructor.name}</p><p className="text-xs text-muted-foreground">{course.instructor.role}</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{course.instructor.bio}</p></div></div></section>
            </div>
          )}

          {tab === "modules" && (
            <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Modules de la formation">
              <div className="border-b border-border px-5 py-4"><h2 className="font-display text-lg font-bold">Contenu de la formation</h2><p className="text-xs text-muted-foreground">{total} modules · {formatDuration(courseMinutes(course))}</p></div>
              <ol className="divide-y divide-border">
                {course.modules.map((m, i) => {
                  const done = completedSet.has(m.id);
                  const open = isModuleOpen(course, i, enrolled, completedSet);
                  const current = status === "cours" && m.id === next?.id;
                  const KindIcon = kindIcon[m.kind];
                  return (
                    <li key={m.id}>
                      <AppLink to={`/formations/${course.id}/modules/${m.id}`} className={cn("flex items-center gap-3 px-5 py-3.5 transition hover:bg-accent/40", current && "bg-primary/5")}>
                        <span className={cn("grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold", done ? "bg-success/15 text-success" : current ? "bg-primary text-primary-foreground" : open ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground")}>{done ? <Check className="size-5" /> : open ? (current ? <Play className="size-5" /> : i + 1) : <Lock className="size-4" />}</span>
                        <span className="min-w-0 flex-1"><span className={cn("block truncate text-sm font-semibold", !open && "text-muted-foreground")}>{m.title}</span><span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground"><KindIcon className="size-3.5" />{kindMeta[m.kind].label}<span>·</span>{formatDuration(m.minutes)}</span></span>
                        {status === "non" && m.preview && <Pill tone="primary">Aperçu</Pill>}
                        {current && <Pill tone="primary">À suivre</Pill>}
                      </AppLink>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {tab === "avis" && (
            <div className="space-y-4">
              {enrolled && userId && <ReviewForm key={myReview?.id ?? "new"} courseId={course.id} userId={userId} mine={myReview ? { rating: myReview.rating, text: myReview.text } : undefined} />}
              <section className="grid gap-4 lg:grid-cols-[220px_1fr]">
                <div className="rounded-xl border border-border bg-card p-5 text-center lg:text-left">{course.reviews > 0 ? <><p className="font-display text-4xl font-bold">{course.rating.toString().replace(".", ",")}</p><RatingStars value={course.rating} size="md" /><p className="mt-1 text-xs text-muted-foreground">{course.reviews} avis</p></> : <p className="text-sm text-muted-foreground">Pas encore d'avis.</p>}</div>
                {reviewsQuery.isPending ? <div className="h-24 animate-pulse rounded-xl bg-foreground/10" aria-busy />
                  : reviewsQuery.isError ? <InlineAlert tone="danger" title="Impossible de charger les avis">Réessayez dans un instant.</InlineAlert>
                  : reviews.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{enrolled ? "Soyez le premier à donner votre avis." : "Les avis des étudiants inscrits apparaîtront ici."}</p>
                  : <ul className="space-y-3">{reviews.map((r) => <li key={r.id} className="rounded-xl border border-border bg-card p-4"><div className="flex items-center gap-3"><Avatar name={r.author} size="sm" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{r.author}</p><p className="text-[11px] text-muted-foreground">{timeAgo(r.createdAt)}</p></div><RatingStars value={r.rating} /></div>{r.text && <p className="mt-3 text-sm leading-6 text-muted-foreground">{r.text}</p>}</li>)}</ul>}
              </section>
            </div>
          )}
        </div>

        {/* Carte d'inscription */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
            <div className={cn("relative grid h-36 place-items-center bg-gradient-to-br", course.tone)}><div className="dot-grid absolute inset-0 opacity-40" /><Icon className="relative size-14 text-primary" /></div>
            <div className="p-5">
              <PriceTag price={course.price} className="text-3xl" />
              {status === "non" && course.price > 0 && <p className="text-xs text-muted-foreground">Paiement unique · accès illimité</p>}
              <div className="mt-4 space-y-2.5">{cta}</div>
              <ul className="mt-5 space-y-2.5 border-t border-border pt-4 text-sm text-muted-foreground">
                <li className="flex items-center gap-2.5"><BookOpen className="size-4 shrink-0 text-primary" />{total} modules · {formatDuration(courseMinutes(course))}</li>
                <li className="flex items-center gap-2.5"><Certificate className="size-4 shrink-0 text-primary" />Certificat de réussite</li>
                <li className="flex items-center gap-2.5"><Smartphone className="size-4 shrink-0 text-primary" />Accessible sur mobile</li>
                <li className="flex items-center gap-2.5"><Trophy className="size-4 shrink-0 text-primary" />{updatedLabel(course.updatedAt)}</li>
              </ul>
            </div>
          </div>
        </aside>
      </div>

      <EnrollDialog course={course} open={enrollOpen} onOpenChange={setEnrollOpen} freeBusy={actions.enrollFree.isPending}
        onEnrollFree={() => actions.enrollFree.mutateAsync(course.id)} onPaid={() => void actions.refresh()} />
    </div>
  );
}
