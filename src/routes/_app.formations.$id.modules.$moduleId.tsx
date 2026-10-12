import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Article, Certificate, Check, CheckCircle, File, Lock, Play, Search, SkipNext, SkipPrevious, Trophy, Video } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { LoadingButtonLabel, StateScreen } from "@/components/cm/feedback";
import { NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { ProgressBar } from "@/components/academy/CourseCard";
import { ContentLoading, ContentMissing, ContentPlayer } from "@/components/academy/players";
import { courseProgress, formatDuration, isModuleOpen, kindMeta, type ModuleKind } from "@/lib/academy-model";
import { useAcademyActions, useCourse, useLearner, useModuleContent } from "@/lib/api/academy";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/formations/$id/modules/$moduleId")({
  head: () => ({ meta: [{ title: "Module — Campus Academy" }] }),
  component: ModuleRoute,
});

const kindIcon: Record<ModuleKind, typeof Video> = { video: Video, pdf: File, article: Article };

function ModuleRoute() {
  const { id, moduleId } = Route.useParams();
  return <ModulePage key={`${id}/${moduleId}`} id={id} moduleId={moduleId} />;
}

function ModulePage({ id, moduleId }: { id: string; moduleId: string }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const courseQuery = useCourse(id);
  const course = courseQuery.data;
  const learner = useLearner(userId).data;
  const actions = useAcademyActions(userId);
  const [justDone, setJustDone] = useState(false);

  const index = course ? course.modules.findIndex((m) => m.id === moduleId) : -1;
  const mod = course && index >= 0 ? course.modules[index] : undefined;
  const completed = learner?.completed ?? new Set<string>();
  const enrolled = course ? (learner?.enrolled.has(course.id) ?? false) : false;
  const prev = course && index > 0 ? course.modules[index - 1] : undefined;
  const next = course && index >= 0 ? course.modules[index + 1] : undefined;
  const accessible = !!course && index >= 0 && isModuleOpen(course, index, enrolled, completed);
  const p = course ? courseProgress(course, completed) : { done: 0, total: 0, pct: 0, complete: false };
  const content = useModuleContent(moduleId, mod?.kind ?? "article", accessible && !!mod);

  const crumbs = [{ label: "Accueil", to: "/" }, { label: "Formations", to: "/formations" }, { label: course?.title ?? "Formation", to: course ? `/formations/${course.id}` : "/formations" }, { label: mod?.title ?? "Module" }];
  const back = (
    <nav aria-label="Fil d'Ariane" className="mb-3"><ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">{crumbs.map((c, i) => <li key={`${i}-${c.label}`} className="flex items-center gap-1">{c.to && i < crumbs.length - 1 ? <AppLink to={c.to} className="hover:text-primary hover:underline">{c.label}</AppLink> : <span aria-current="page" className="font-semibold text-foreground">{c.label}</span>}{i < crumbs.length - 1 && <span aria-hidden>›</span>}</li>)}</ol></nav>
  );

  if (courseQuery.isPending) return <div>{back}<div className="grid gap-6 lg:grid-cols-[1fr_340px]" aria-busy><div className="aspect-video animate-pulse rounded-xl bg-foreground/10" /><div className="h-80 animate-pulse rounded-xl bg-foreground/10" /></div></div>;
  if (courseQuery.isError) return <div>{back}{isNetworkError(courseQuery.error) ? <NetworkErrorScreen compact onRetry={() => void courseQuery.refetch()} /> : <ServerErrorScreen compact onRetry={() => void courseQuery.refetch()} />}</div>;
  if (!course || !mod) {
    return <div>{back}<StateScreen icon={Search} title="Module introuvable" description="Ce module n'existe pas dans cette formation." actions={<Button asChild size="lg"><AppLink to={course ? `/formations/${course.id}` : "/formations"}>Retour à la formation</AppLink></Button>} /></div>;
  }

  const isDone = completed.has(mod.id);
  const finish = () => {
    if (!enrolled) return;
    actions.completeModule.mutate(mod.id, {
      onSuccess: () => setJustDone(true),
      onError: (e) => toast.error("Progression non enregistrée", { description: friendlyError(e) }),
    });
  };

  /* ---------- Contenu principal selon l'état ---------- */
  let main;
  if (!accessible) {
    main = (
      <div className="rounded-xl border border-border bg-card">
        <StateScreen icon={Lock} tone="warning" title="Module verrouillé"
          description={!enrolled ? "Ce module est réservé aux étudiants inscrits à la formation." : prev ? `Terminez d'abord le module « ${prev.title} » pour débloquer celui-ci.` : "Ce module n'est pas encore disponible."}
          actions={!enrolled ? <Button asChild size="lg"><AppLink to={`/formations/${course.id}`}>S'inscrire à la formation</AppLink></Button> : prev ? <Button asChild size="lg"><AppLink to={`/formations/${course.id}/modules/${prev.id}`}><ArrowLeft /> Module précédent</AppLink></Button> : undefined} />
      </div>
    );
  } else if (justDone && p.complete) {
    main = (
      <div className="dark rounded-xl border border-primary/30 bg-gradient-to-br from-primary/20 via-card to-card p-6 text-center text-foreground sm:p-10">
        <span className="mx-auto grid size-24 place-items-center rounded-full bg-primary/15 text-primary ring-8 ring-primary/10"><Trophy className="size-12" /></span>
        <h2 className="mt-5 font-display text-3xl font-bold">Formation terminée !</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Félicitations, vous avez terminé « {course.title} ». Votre certificat de réussite est prêt.</p>
        <div className="mx-auto mt-5 max-w-xs"><ProgressBar pct={100} className="h-3" /></div>
        <div className="mx-auto mt-7 grid max-w-md gap-2.5 sm:grid-cols-2"><Button asChild size="lg"><AppLink to={`/formations/${course.id}/certificat`}><Certificate /> Voir mon certificat</AppLink></Button><Button asChild size="lg" variant="outline"><AppLink to="/formations">Autres formations</AppLink></Button></div>
      </div>
    );
  } else if (justDone) {
    main = (
      <div className="rounded-xl border border-border bg-card p-6 text-center sm:p-8">
        <span className="mx-auto grid size-20 place-items-center rounded-full bg-success/15 text-success ring-8 ring-success/10"><CheckCircle className="size-11" /></span>
        <h2 className="mt-5 font-display text-2xl font-bold">Module terminé !</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">Bravo, « {mod.title} » est validé.</p>
        <div className="mx-auto mt-5 max-w-sm"><div className="mb-1.5 flex justify-between text-xs"><span className="font-semibold">Progression de la formation</span><span className="font-bold text-primary">{p.pct} %</span></div><ProgressBar pct={p.pct} className="h-3" /></div>
        {next ? (
          <div className="mx-auto mt-6 max-w-md rounded-xl border border-primary/25 bg-primary/5 p-4 text-left">
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Module suivant</p>
            <p className="mt-1 font-semibold">{next.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{kindMeta[next.kind].label} · {formatDuration(next.minutes)}</p>
            <Button asChild size="lg" className="mt-4 w-full"><AppLink to={`/formations/${course.id}/modules/${next.id}`}>Continuer <ArrowRight /></AppLink></Button>
          </div>
        ) : (
          <div className="mx-auto mt-6 max-w-md"><Button asChild size="lg" className="w-full"><AppLink to={`/formations/${course.id}`}>Retour à la formation</AppLink></Button></div>
        )}
      </div>
    );
  } else {
    main = (
      <>
        {content.isPending ? <ContentLoading />
          : content.isError ? <ContentMissing error onRetry={() => void content.refetch()} />
          : content.data ? <ContentPlayer mod={mod} content={content.data} />
          : <ContentMissing />}
        <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><div className="flex items-center gap-2"><Pill tone="primary">{kindMeta[mod.kind].label}</Pill><span className="text-xs text-muted-foreground">Module {index + 1} sur {course.modules.length} · {formatDuration(mod.minutes)}</span></div><h2 className="mt-2 font-display text-xl font-bold">{mod.title}</h2></div>
          {isDone ? <Pill tone="success" icon={Check}>Terminé</Pill>
            : enrolled ? <Button size="lg" disabled={actions.completeModule.isPending} onClick={finish}><LoadingButtonLabel loading={actions.completeModule.isPending} loadingText="Enregistrement…"><Check /> Marquer comme terminé</LoadingButtonLabel></Button>
            : <Button asChild size="lg"><AppLink to={`/formations/${course.id}`}>S'inscrire pour continuer</AppLink></Button>}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2.5 border-t border-border pt-5">
          {prev ? <Button asChild variant="outline"><AppLink to={`/formations/${course.id}/modules/${prev.id}`}><SkipPrevious /> Précédent</AppLink></Button> : <span />}
          {next ? <Button asChild variant="outline" className="justify-self-end"><AppLink to={`/formations/${course.id}/modules/${next.id}`}>Suivant <SkipNext /></AppLink></Button> : <span />}
        </div>
      </>
    );
  }

  return (
    <div>
      <h1 className="sr-only">{mod.title}</h1>
      {back}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">{main}</div>
        <aside aria-label="Contenu de la formation" className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border p-4"><AppLink to={`/formations/${course.id}`} className="block truncate font-display text-sm font-bold hover:text-primary">{course.title}</AppLink>{enrolled && <div className="mt-2 flex items-center gap-3"><ProgressBar pct={p.pct} className="flex-1" label="Progression de la formation" /><span className="text-xs font-bold text-primary">{p.pct} %</span></div>}</div>
            <ol className="max-h-[60vh] divide-y divide-border overflow-y-auto">
              {course.modules.map((m, i) => {
                const done = completed.has(m.id);
                const open = isModuleOpen(course, i, enrolled, completed);
                const KindIcon = kindIcon[m.kind];
                return (
                  <li key={m.id}>
                    <AppLink to={`/formations/${course.id}/modules/${m.id}`} aria-current={m.id === mod.id ? "page" : undefined} className={cn("flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-accent/40", m.id === mod.id && "bg-primary/8 shadow-[inset_3px_0_0_var(--primary)]")}>
                      <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold", done ? "bg-success/15 text-success" : m.id === mod.id ? "bg-primary text-primary-foreground" : open ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground")}>{done ? <Check className="size-4" /> : open ? (m.id === mod.id ? <Play className="size-4" /> : i + 1) : <Lock className="size-3.5" />}</span>
                      <span className="min-w-0 flex-1"><span className={cn("block truncate font-semibold", !open && "text-muted-foreground")}>{m.title}</span><span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><KindIcon className="size-3.5" />{formatDuration(m.minutes)}</span></span>
                    </AppLink>
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
