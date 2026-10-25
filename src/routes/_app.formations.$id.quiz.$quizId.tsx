import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, CheckCircle, Clock, Search, Trophy } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { InlineAlert, LoadingButtonLabel, StateScreen } from "@/components/cm/feedback";
import { NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { useCourseQuizzes, useMyAttempts, useStartAttempt, useSubmitAttempt, type AttemptResult, type StartedAttempt } from "@/lib/api/quizzes";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/formations/$id/quiz/$quizId")({
  head: () => ({ meta: [{ title: "Quiz — Campus Academy" }] }),
  component: QuizPage,
});

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function QuizPage() {
  const { id, quizId } = Route.useParams();
  return <QuizScreen key={quizId} courseId={id} quizId={quizId} />;
}

function QuizScreen({ courseId, quizId }: { courseId: string; quizId: string }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const quizzes = useCourseQuizzes(courseId);
  const attempts = useMyAttempts(userId);
  const start = useStartAttempt();
  const submit = useSubmitAttempt(userId);
  const [attempt, setAttempt] = useState<StartedAttempt | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);

  const quiz = quizzes.data?.find((q) => q.id === quizId);
  const mine = (attempts.data ?? []).filter((a) => a.quizId === quizId);
  const best = mine.reduce<number | null>((m, a) => (m === null || a.scorePercent > m ? a.scorePercent : m), null);
  const left = quiz?.maxAttempts != null ? Math.max(0, quiz.maxAttempts - mine.length) : null;
  const crumbs = [{ label: "Accueil", to: "/" }, { label: "Formations", to: "/formations" }, { label: "Formation", to: `/formations/${courseId}` }, { label: quiz?.title ?? "Quiz" }];

  if (quizzes.isPending) return <div className="mx-auto max-w-3xl px-4 py-6" aria-busy><div className="h-64 animate-pulse rounded-xl bg-foreground/10" /></div>;
  if (quizzes.isError) return <div className="mx-auto max-w-3xl px-4 py-6">{isNetworkError(quizzes.error) ? <NetworkErrorScreen compact onRetry={() => void quizzes.refetch()} /> : <ServerErrorScreen compact onRetry={() => void quizzes.refetch()} />}</div>;
  if (!quiz || quiz.status !== "published") {
    return <div className="mx-auto max-w-3xl px-4 py-6"><StateScreen icon={Search} title="Quiz introuvable" description="Ce quiz n'existe pas ou n'est pas encore publié." actions={<Button asChild size="lg"><AppLink to={`/formations/${courseId}`}>Retour à la formation</AppLink></Button>} /></div>;
  }

  const begin = () => start.mutate(quiz.id, { onSuccess: (a) => { setResult(null); setAttempt(a); } });

  if (result) return <ResultView title={quiz.title} courseId={courseId} result={result} canRetry={left === null || left > 0} onRetry={() => { setResult(null); begin(); }} />;

  if (attempt) {
    return <Runner attempt={attempt} pending={submit.isPending} error={submit.isError ? friendlyError(submit.error, "La remise a échoué. Réessayez.") : null}
      onSubmit={(answers) => submit.mutate({ attemptId: attempt.attemptId, answers }, { onSuccess: (r) => { setAttempt(null); setResult(r); } })} />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <PageHeader kicker="Campus Academy" title={quiz.title} breadcrumbs={crumbs} />
      <div className="rounded-xl border bg-card p-5">
        {quiz.description && <p className="mb-4 text-sm text-muted-foreground">{quiz.description}</p>}
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Seuil de réussite</dt><dd className="font-semibold">{quiz.passPercent} %</dd></div>
          <div><dt className="text-xs text-muted-foreground">Durée</dt><dd className="font-semibold">{quiz.timeLimitMinutes ? `${quiz.timeLimitMinutes} min` : "Sans limite"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Tentatives</dt><dd className="font-semibold">{quiz.maxAttempts ? `${mine.length} / ${quiz.maxAttempts}` : `${mine.length} (illimitées)`}</dd></div>
        </dl>
        {best !== null && <p className="mt-4 text-sm">Votre meilleur score : <strong>{best} %</strong></p>}
        {quiz.timeLimitMinutes && <p className="mt-3 text-xs text-muted-foreground">Le chronomètre démarre dès que vous commencez. À la fin du temps, vos réponses sont remises automatiquement ; une tentative remise hors délai ne compte pas comme réussie.</p>}
        {start.isError && <div className="mt-4"><InlineAlert tone="danger">{friendlyError(start.error, "Impossible de démarrer le quiz.")}</InlineAlert></div>}
        <div className="mt-5 flex flex-wrap gap-2.5">
          <Button size="lg" disabled={start.isPending || left === 0} onClick={begin}><LoadingButtonLabel loading={start.isPending} loadingText="Préparation…">{mine.length > 0 ? "Repasser le quiz" : "Commencer le quiz"}</LoadingButtonLabel></Button>
          <Button asChild size="lg" variant="outline"><AppLink to={`/formations/${courseId}`}><ArrowLeft /> Retour à la formation</AppLink></Button>
        </div>
        {left === 0 && <p className="mt-3 text-sm text-muted-foreground">Vous avez utilisé toutes vos tentatives.</p>}
      </div>
    </div>
  );
}

function Runner({ attempt, pending, error, onSubmit }: { attempt: StartedAttempt; pending: boolean; error: string | null; onSubmit: (a: Record<string, number[]>) => void }) {
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const deadline = useMemo(() => (attempt.timeLimitMinutes ? new Date(attempt.startedAt).getTime() + attempt.timeLimitMinutes * 60_000 : null), [attempt]);
  const [remaining, setRemaining] = useState<number | null>(deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : null);
  const sent = useRef(false);

  const send = useCallback(() => {
    if (sent.current) return;
    sent.current = true;
    onSubmit(answers);
  }, [answers, onSubmit]);

  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setRemaining(Math.max(0, Math.round((deadline - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  useEffect(() => { if (remaining === 0) send(); }, [remaining, send]);
  useEffect(() => { if (error) sent.current = false; }, [error]);

  const toggle = (qid: string, i: number, multiple: boolean) =>
    setAnswers((a) => {
      const cur = a[qid] ?? [];
      return { ...a, [qid]: multiple ? (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort()) : [i] };
    });
  const answered = attempt.questions.filter((q) => (answers[q.id] ?? []).length > 0).length;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="sticky top-16 z-10 mb-4 flex items-center justify-between gap-3 rounded-xl border bg-card/95 p-3 backdrop-blur">
        <div className="min-w-0"><p className="truncate font-display font-bold">{attempt.title}</p><p className="text-xs text-muted-foreground">{answered} / {attempt.questions.length} questions répondues</p></div>
        {remaining !== null && <Pill tone={remaining <= 60 ? "danger" : "primary"} icon={Clock}>{clock(remaining)}</Pill>}
      </div>
      <ol className="space-y-4">
        {attempt.questions.map((q, n) => (
          <li key={q.id} className="rounded-xl border bg-card p-4">
            <fieldset>
              <legend className="font-semibold"><span className="mr-2 text-primary">{n + 1}.</span>{q.prompt}</legend>
              <p className="mt-1 text-xs text-muted-foreground">{q.multiple ? "Plusieurs réponses possibles." : "Une seule réponse."}</p>
              <div className="mt-3 space-y-2">
                {q.options.map((o, i) => {
                  const on = (answers[q.id] ?? []).includes(i);
                  return (
                    <label key={i} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition hover:bg-accent/40", on && "border-primary bg-primary/8")}>
                      <input type={q.multiple ? "checkbox" : "radio"} name={q.id} checked={on} onChange={() => toggle(q.id, i, q.multiple)} className="mt-0.5 size-4 accent-[var(--primary)]" />
                      <span>{o}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      {error && <div className="mt-4"><InlineAlert tone="danger">{error}</InlineAlert></div>}
      <div className="mt-5"><Button size="lg" className="w-full sm:w-auto" disabled={pending} onClick={send}><LoadingButtonLabel loading={pending} loadingText="Correction…"><Check /> Remettre mes réponses</LoadingButtonLabel></Button>
        {answered < attempt.questions.length && <p className="mt-2 text-xs text-muted-foreground">Les questions sans réponse comptent comme fausses.</p>}</div>
    </div>
  );
}

function ResultView({ title, courseId, result, canRetry, onRetry }: { title: string; courseId: string; result: AttemptResult; canRetry: boolean; onRetry: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className={cn("rounded-xl border p-6 text-center", result.passed ? "border-success/40 bg-success/8" : "border-border bg-card")}>
        <span className={cn("mx-auto grid size-20 place-items-center rounded-full", result.passed ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{result.passed ? <Trophy className="size-10" /> : <CheckCircle className="size-10" />}</span>
        <h1 className="mt-4 font-display text-2xl font-bold">{result.passed ? "Quiz réussi !" : result.timedOut ? "Temps écoulé" : "Quiz non réussi"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">« {title} »</p>
        <p className="mt-3 font-display text-4xl font-bold text-primary">{result.score} %</p>
        <p className="text-sm text-muted-foreground">{result.correctCount} bonne{result.correctCount > 1 ? "s" : ""} réponse{result.correctCount > 1 ? "s" : ""} sur {result.total} · seuil {result.passPercent} %</p>
        {result.timedOut && <p className="mt-2 text-xs text-muted-foreground">Remis après la fin du temps : la tentative ne peut pas compter comme réussie.</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          {canRetry && <Button size="lg" onClick={onRetry}>Réessayer</Button>}
          <Button asChild size="lg" variant="outline"><AppLink to={`/formations/${courseId}`}>Retour à la formation</AppLink></Button>
          <Button asChild size="lg" variant="outline"><AppLink to="/progression">Ma progression</AppLink></Button>
        </div>
      </div>
      <h2 className="mb-3 mt-6 font-display text-lg font-bold">Correction</h2>
      <ol className="space-y-3">
        {result.review.map((r, n) => (
          <li key={r.questionId} className={cn("rounded-xl border bg-card p-4", r.isCorrect ? "border-success/40" : "border-destructive/40")}>
            <p className="flex items-start justify-between gap-2 font-semibold"><span><span className="mr-2 text-primary">{n + 1}.</span>{r.prompt}</span><Pill tone={r.isCorrect ? "success" : "danger"}>{r.isCorrect ? "Juste" : "Faux"}</Pill></p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {r.options.map((o, i) => {
                const good = r.correct.includes(i); const chosen = r.selected.includes(i);
                return <li key={i} className={cn("rounded-md border px-3 py-2", good ? "border-success/50 bg-success/10" : chosen ? "border-destructive/50 bg-destructive/10" : "border-transparent")}>{o}{good && <span className="ml-2 text-xs font-semibold text-success">bonne réponse</span>}{chosen && !good && <span className="ml-2 text-xs font-semibold text-destructive">votre choix</span>}{chosen && good && <span className="ml-2 text-xs text-muted-foreground">(votre choix)</span>}</li>;
              })}
            </ul>
            {r.explanation && <p className="mt-3 rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">{r.explanation}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
