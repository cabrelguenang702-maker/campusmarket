import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Medal } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { InlineAlert, LoadingButtonLabel } from "@/components/cm/feedback";
import { EmptyScreen, NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { ProgressBar } from "@/components/academy/CourseCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { useLearningSummary, useSetGoals, type LearningSummary } from "@/lib/api/quizzes";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/domain";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/progression")({
  head: () => ({ meta: [{ title: "Ma progression — Campus Academy" }] }),
  component: ProgressPage,
});

const pct = (done: number, goal: number) => (goal <= 0 ? 100 : Math.min(100, Math.round((100 * done) / goal)));

function ProgressPage() {
  const { session } = useAuth();
  const q = useLearningSummary(session?.user.id);
  const crumbs = [{ label: "Accueil", to: "/" }, { label: "Formations", to: "/formations" }, { label: "Ma progression" }];
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <PageHeader kicker="Campus Academy" title="Ma progression" description="Vos objectifs de la semaine, vos résultats aux quiz et vos badges." breadcrumbs={crumbs} />
      {q.isPending ? <div aria-busy className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-foreground/10" />)}</div>
        : q.isError ? (isNetworkError(q.error) ? <NetworkErrorScreen onRetry={() => void q.refetch()} /> : <ServerErrorScreen onRetry={() => void q.refetch()} />)
        : <Dashboard s={q.data} userId={session?.user.id} />}
    </div>
  );
}

function Dashboard({ s, userId }: { s: LearningSummary; userId: string | undefined }) {
  const empty = s.lessonsCompleted === 0 && s.quizzesAttempted === 0 && s.courses.length === 0;
  const earned = s.badges.filter((b) => b.awardedAt);
  const maxDay = Math.max(1, ...s.activity.map((a) => a.count));
  return (
    <div className="space-y-5">
      <GoalsCard s={s} userId={userId} />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Chiffres clés">
        {[["Leçons terminées", s.lessonsCompleted], ["Quiz passés", s.quizzesAttempted], ["Quiz réussis", s.quizzesPassed], ["Score moyen", s.avgScore === null ? "—" : `${s.avgScore} %`]].map(([l, v]) => (
          <div key={String(l)} className="rounded-xl border bg-card p-4 text-center"><p className="font-display text-2xl font-bold text-primary">{v}</p><p className="text-xs text-muted-foreground">{l}</p></div>
        ))}
      </section>

      {empty ? <EmptyScreen title="Rien à suivre pour l'instant" description="Inscrivez-vous à une formation et terminez une leçon : votre progression apparaîtra ici." actions={<Button asChild><AppLink to="/formations">Voir les formations</AppLink></Button>} /> : (
        <>
          <section className="rounded-xl border bg-card p-4" aria-label="Activité des 14 derniers jours">
            <h2 className="font-display text-base font-bold">Activité des 14 derniers jours</h2>
            <p className="text-xs text-muted-foreground">Leçons terminées et quiz remis, par jour.</p>
            <div className="mt-3 flex h-24 items-end gap-1" role="img" aria-label={`Activité : ${s.activity.map((a) => `${a.day} ${a.count}`).join(", ")}`}>
              {s.activity.map((a) => <div key={a.day} title={`${formatDate(a.day)} : ${a.count}`} className={cn("flex-1 rounded-t", a.count ? "bg-primary" : "bg-muted")} style={{ height: `${a.count ? Math.max(12, (100 * a.count) / maxDay) : 6}%` }} />)}
            </div>
          </section>

          {s.courses.length > 0 && (
            <section className="rounded-xl border bg-card p-4" aria-label="Mes formations">
              <h2 className="font-display text-base font-bold">Mes formations</h2>
              <ul className="mt-3 space-y-3">
                {s.courses.map((c) => { const p = pct(c.done, c.total); return (
                  <li key={c.courseId}><div className="mb-1 flex justify-between gap-2 text-sm"><AppLink to={`/formations/${c.courseId}`} className="truncate font-semibold hover:text-primary">{c.title}</AppLink><span className="shrink-0 text-xs text-muted-foreground">{c.done}/{c.total} · {p} %</span></div><ProgressBar pct={p} label={`Progression : ${c.title}`} />{c.lastActivity && <p className="mt-1 text-[11px] text-muted-foreground">Dernière activité : {formatDate(c.lastActivity)}</p>}</li>
                ); })}
              </ul>
            </section>
          )}

          {s.byCategory.length > 0 && (
            <section className="rounded-xl border bg-card p-4" aria-label="Résultats par domaine">
              <h2 className="font-display text-base font-bold">Résultats aux quiz par domaine</h2>
              <p className="text-xs text-muted-foreground">Moyenne de vos tentatives remises. Cela vous aide à repérer les domaines à retravailler.</p>
              <ul className="mt-3 space-y-2.5">{s.byCategory.map((c) => <li key={c.slug}><div className="mb-1 flex justify-between text-sm"><span className="font-semibold">{c.name}</span><span className="text-xs text-muted-foreground">{c.avgScore ?? 0} % · {c.attempts} tentative{c.attempts > 1 ? "s" : ""}</span></div><ProgressBar pct={c.avgScore ?? 0} label={`Moyenne : ${c.name}`} /></li>)}</ul>
            </section>
          )}
        </>
      )}

      <section aria-label="Badges">
        <div className="mb-3 flex items-baseline justify-between gap-2"><h2 className="font-display text-lg font-bold">Badges ({earned.length}/{s.badges.length})</h2></div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {s.badges.map((b) => (
            <li key={b.code} className={cn("flex gap-3 rounded-xl border bg-card p-4", !b.awardedAt && "opacity-75")}>
              <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", b.awardedAt ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{b.awardedAt ? <Medal className="size-6" /> : <Lock className="size-5" />}</span>
              <div className="min-w-0"><p className="flex flex-wrap items-center gap-2 font-semibold">{b.title}{b.awardedAt && <Pill tone="success">Obtenu le {formatDate(b.awardedAt)}</Pill>}</p><p className="text-sm text-muted-foreground">{b.description}</p><p className="mt-1 text-[11px] text-muted-foreground">Règle : {b.rule}</p></div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Les badges sont des indicateurs d'apprentissage personnels : ils ne constituent pas une qualification officielle et ne sont pas partagés publiquement.</p>
      </section>
    </div>
  );
}

function GoalsCard({ s, userId }: { s: LearningSummary; userId: string | undefined }) {
  const [editing, setEditing] = useState(false);
  const [lessons, setLessons] = useState(String(s.goalLessons));
  const [quizzes, setQuizzes] = useState(String(s.goalQuizzes));
  const set = useSetGoals(userId);
  const valid = (v: string) => /^\d{1,2}$/.test(v) && Number(v) <= 50;
  const rows = [["Leçons terminées", s.weekLessons, s.goalLessons], ["Quiz remis", s.weekQuizzes, s.goalQuizzes]] as const;
  return (
    <section className="rounded-xl border bg-card p-4" aria-label="Objectifs de la semaine">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-display text-base font-bold">Objectifs de la semaine</h2><Button variant="outline" size="sm" onClick={() => setEditing((e) => !e)}>{editing ? "Fermer" : "Modifier"}</Button></div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {rows.map(([label, done, goal]) => (
          <div key={label}><div className="mb-1 flex justify-between text-sm"><span className="font-semibold">{label}</span><span className="text-xs text-muted-foreground">{done} / {goal}</span></div><ProgressBar pct={pct(done, goal)} label={label} /></div>
        ))}
      </div>
      {editing && (
        <div className="mt-4 border-t pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold">Leçons par semaine<Input className="mt-1" inputMode="numeric" value={lessons} onChange={(e) => setLessons(e.target.value)} /></label>
            <label className="text-sm font-semibold">Quiz par semaine<Input className="mt-1" inputMode="numeric" value={quizzes} onChange={(e) => setQuizzes(e.target.value)} /></label>
          </div>
          {set.isError && <div className="mt-3"><InlineAlert tone="danger">{friendlyError(set.error, "Objectifs non enregistrés.")}</InlineAlert></div>}
          {(!valid(lessons) || !valid(quizzes)) && <p className="mt-2 text-xs text-destructive">Entrez des nombres entiers entre 0 et 50.</p>}
          <Button className="mt-3" disabled={!valid(lessons) || !valid(quizzes) || set.isPending} onClick={() => set.mutate({ weeklyLessons: Number(lessons), weeklyQuizzes: Number(quizzes) }, { onSuccess: () => { toast.success("Objectifs enregistrés"); setEditing(false); } })}>
            <LoadingButtonLabel loading={set.isPending} loadingText="Enregistrement…">Enregistrer</LoadingButtonLabel>
          </Button>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">La semaine commence le lundi (heure du Cameroun).</p>
    </section>
  );
}
