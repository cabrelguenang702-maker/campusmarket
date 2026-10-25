import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { ConfirmDialog, InlineAlert, LoadingButtonLabel, StateScreen } from "@/components/cm/feedback";
import { NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { useCourse } from "@/lib/api/academy";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { useIsCourseAuthor, useQuizAuthoring, useQuizForEdit, useQuizStats, type QuizDraft, type QuizDraftQuestion } from "@/lib/api/quizzes";
import { useAuth } from "@/lib/auth";
import { Search } from "@/components/icons";

export const Route = createFileRoute("/_app/formations/$id/quiz-editeur/$quizId")({
  head: () => ({ meta: [{ title: "Éditer un quiz — Campus Academy" }] }),
  component: EditorPage,
});

const blankQuestion = (): QuizDraftQuestion => ({ prompt: "", options: ["", ""], correct: [], explanation: "" });
const blankDraft = (): QuizDraft => ({ title: "", description: "", passPercent: 60, maxAttempts: null, timeLimitMinutes: null, moduleId: null, shuffle: true, status: "draft", questions: [blankQuestion()] });
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function EditorPage() {
  const { id, quizId } = Route.useParams();
  const isNew = quizId === "nouveau";
  const { session } = useAuth();
  const userId = session?.user.id;
  const author = useIsCourseAuthor(id, userId);
  const course = useCourse(id).data;
  const edit = useQuizForEdit(isNew ? undefined : quizId);
  const crumbs = [{ label: "Accueil", to: "/" }, { label: "Formations", to: "/formations" }, { label: course?.title ?? "Formation", to: `/formations/${id}` }, { label: isNew ? "Nouveau quiz" : "Éditer le quiz" }];

  if (author.isPending || (!isNew && edit.isPending)) return <div className="mx-auto max-w-3xl px-4 py-6" aria-busy><div className="h-64 animate-pulse rounded-xl bg-foreground/10" /></div>;
  if (author.isError || (!isNew && edit.isError)) {
    const e = author.error ?? edit.error;
    return <div className="mx-auto max-w-3xl px-4 py-6">{isNetworkError(e) ? <NetworkErrorScreen compact onRetry={() => { void author.refetch(); void edit.refetch(); }} /> : <ServerErrorScreen compact onRetry={() => { void author.refetch(); void edit.refetch(); }} />}</div>;
  }
  if (!author.data) return <div className="mx-auto max-w-3xl px-4 py-6"><StateScreen icon={Search} title="Accès réservé" description="Seul l'auteur de la formation peut créer ou modifier ses quiz." actions={<Button asChild size="lg"><AppLink to={`/formations/${id}`}>Retour à la formation</AppLink></Button>} /></div>;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <PageHeader kicker="Campus Academy" title={isNew ? "Nouveau quiz" : "Éditer le quiz"} breadcrumbs={crumbs} />
      <EditorForm key={quizId} courseId={id} quizId={isNew ? null : quizId} initial={edit.data?.draft ?? blankDraft()} hasAttempts={edit.data?.hasAttempts ?? false} modules={course?.modules.map((m) => ({ id: m.id, title: m.title })) ?? []} />
    </div>
  );
}

function EditorForm({ courseId, quizId, initial, hasAttempts, modules }: { courseId: string; quizId: string | null; initial: QuizDraft; hasAttempts: boolean; modules: { id: string; title: string }[] }) {
  const navigate = useNavigate();
  const authoring = useQuizAuthoring(courseId);
  const stats = useQuizStats(quizId ?? undefined, hasAttempts);
  const [d, setD] = useState<QuizDraft>(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { setD(initial); }, [initial]);

  const patch = (p: Partial<QuizDraft>) => setD((x) => ({ ...x, ...p }));
  const setQ = (i: number, p: Partial<QuizDraftQuestion>) => setD((x) => ({ ...x, questions: x.questions.map((q, k) => (k === i ? { ...q, ...p } : q)) }));
  const setOpt = (i: number, j: number, v: string) => setQ(i, { options: d.questions[i]!.options.map((o, k) => (k === j ? v : o)) });
  const addOpt = (i: number) => setQ(i, { options: [...d.questions[i]!.options, ""] });
  const delOpt = (i: number, j: number) => {
    const q = d.questions[i]!;
    setQ(i, { options: q.options.filter((_, k) => k !== j), correct: q.correct.filter((c) => c !== j).map((c) => (c > j ? c - 1 : c)) });
  };
  const toggleCorrect = (i: number, j: number) => { const q = d.questions[i]!; setQ(i, { correct: q.correct.includes(j) ? q.correct.filter((c) => c !== j) : [...q.correct, j].sort() }); };

  const problem = (() => {
    if (d.title.trim().length < 3) return "Donnez un titre d'au moins 3 caractères.";
    if (!hasAttempts) {
      if (d.questions.length < 1) return "Ajoutez au moins une question.";
      for (const [i, q] of d.questions.entries()) {
        if (q.prompt.trim().length < 3) return `Question ${i + 1} : l'énoncé est trop court.`;
        if (q.options.some((o) => o.trim() === "")) return `Question ${i + 1} : tous les choix doivent être remplis (ou supprimés).`;
        if (q.correct.length < 1) return `Question ${i + 1} : cochez au moins une bonne réponse.`;
      }
    }
    return null;
  })();

  const save = () => authoring.save.mutate({ quizId, draft: d, withQuestions: !hasAttempts }, {
    onSuccess: (newId) => { toast.success("Quiz enregistré"); if (!quizId) void navigate({ to: "/formations/$id/quiz-editeur/$quizId", params: { id: courseId, quizId: newId } }); },
  });
  const toggleStatus = () => { if (!quizId) return; authoring.setStatus.mutate({ quizId, status: d.status === "published" ? "draft" : "published" }, { onSuccess: () => { patch({ status: d.status === "published" ? "draft" : "published" }); toast.success(d.status === "published" ? "Quiz repassé en brouillon" : "Quiz publié"); } }); };
  const err = authoring.save.error ?? authoring.setStatus.error ?? authoring.remove.error;

  return (
    <div className="space-y-4">
      {hasAttempts && <InlineAlert tone="warning">Des étudiants ont déjà passé ce quiz : seuls les réglages peuvent être modifiés. Les questions sont verrouillées pour garder des résultats comparables.</InlineAlert>}
      {stats.data && stats.data.attempts > 0 && <div className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 text-center sm:grid-cols-4">{[["Tentatives", stats.data.attempts], ["Étudiants", stats.data.learners], ["Score moyen", stats.data.avgScore === null ? "—" : `${stats.data.avgScore} %`], ["Taux de réussite", stats.data.passRate === null ? "—" : `${stats.data.passRate} %`]].map(([l, v]) => <div key={String(l)}><p className="font-display text-xl font-bold">{v}</p><p className="text-xs text-muted-foreground">{l}</p></div>)}</div>}

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <label className="block text-sm font-semibold">Titre<Input className="mt-1" value={d.title} maxLength={150} onChange={(e) => patch({ title: e.target.value })} /></label>
        <label className="block text-sm font-semibold">Description (facultatif)<Textarea className="mt-1" rows={2} maxLength={1000} value={d.description} onChange={(e) => patch({ description: e.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm font-semibold">Seuil de réussite (%)<Input className="mt-1" type="number" min={0} max={100} value={d.passPercent} onChange={(e) => patch({ passPercent: Number(e.target.value) })} /></label>
          <label className="block text-sm font-semibold">Tentatives max.<Input className="mt-1" type="number" min={1} max={50} placeholder="Illimité" value={d.maxAttempts ?? ""} onChange={(e) => patch({ maxAttempts: numOrNull(e.target.value) })} /></label>
          <label className="block text-sm font-semibold">Durée (minutes)<Input className="mt-1" type="number" min={1} max={240} placeholder="Sans limite" value={d.timeLimitMinutes ?? ""} onChange={(e) => patch({ timeLimitMinutes: numOrNull(e.target.value) })} /></label>
        </div>
        {modules.length > 0 && <label className="block text-sm font-semibold">Module associé (facultatif)<select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={d.moduleId ?? ""} onChange={(e) => patch({ moduleId: e.target.value || null })}><option value="">Toute la formation</option>{modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={d.shuffle} onChange={(e) => patch({ shuffle: e.target.checked })} />Mélanger l'ordre des questions à chaque tentative</label>
      </section>

      {!hasAttempts && (
        <section className="space-y-3">
          {d.questions.map((q, i) => (
            <div key={i} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2"><p className="font-display font-bold">Question {i + 1}</p>
                <Button type="button" variant="ghost" size="sm" aria-label={`Supprimer la question ${i + 1}`} disabled={d.questions.length <= 1} onClick={() => setD((x) => ({ ...x, questions: x.questions.filter((_, k) => k !== i) }))}><Trash /></Button></div>
              <Textarea className="mt-2" rows={2} maxLength={1000} placeholder="Énoncé de la question" value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} />
              <p className="mb-1.5 mt-3 text-xs text-muted-foreground">Cochez toutes les bonnes réponses (une ou plusieurs). Une question à plusieurs bonnes réponses n'est juste que si l'étudiant les coche toutes.</p>
              <div className="space-y-2">
                {q.options.map((o, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <input type="checkbox" className="size-4 accent-[var(--primary)]" aria-label={`Choix ${j + 1} correct`} checked={q.correct.includes(j)} onChange={() => toggleCorrect(i, j)} />
                    <Input value={o} maxLength={300} placeholder={`Choix ${j + 1}`} onChange={(e) => setOpt(i, j, e.target.value)} />
                    <Button type="button" variant="ghost" size="sm" aria-label={`Supprimer le choix ${j + 1}`} disabled={q.options.length <= 2} onClick={() => delOpt(i, j)}><Trash /></Button>
                  </div>
                ))}
              </div>
              {q.options.length < 6 && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => addOpt(i)}><Plus /> Ajouter un choix</Button>}
              <Textarea className="mt-3" rows={2} maxLength={1000} placeholder="Explication affichée après la correction (facultatif)" value={q.explanation} onChange={(e) => setQ(i, { explanation: e.target.value })} />
            </div>
          ))}
          {d.questions.length < 50 && <Button type="button" variant="outline" onClick={() => setD((x) => ({ ...x, questions: [...x.questions, blankQuestion()] }))}><Plus /> Ajouter une question</Button>}
        </section>
      )}

      {problem && <InlineAlert tone="warning">{problem}</InlineAlert>}
      {err && <InlineAlert tone="danger">{friendlyError(err, "L'action a échoué.")}</InlineAlert>}
      <div className="flex flex-wrap items-center gap-2.5">
        <Button size="lg" disabled={!!problem || authoring.save.isPending} onClick={save}><LoadingButtonLabel loading={authoring.save.isPending} loadingText="Enregistrement…">Enregistrer</LoadingButtonLabel></Button>
        {quizId && <Button size="lg" variant="outline" disabled={authoring.setStatus.isPending} onClick={toggleStatus}>{d.status === "published" ? "Repasser en brouillon" : "Publier le quiz"}</Button>}
        {quizId && <Pill tone={d.status === "published" ? "success" : "neutral"}>{d.status === "published" ? "Publié" : "Brouillon"}</Pill>}
        {quizId && !hasAttempts && <Button size="lg" variant="ghost" className="ml-auto text-destructive" onClick={() => setConfirmDelete(true)}><Trash /> Supprimer</Button>}
        <Button asChild size="lg" variant="ghost"><AppLink to={`/formations/${courseId}`}>Retour</AppLink></Button>
      </div>
      <p className="text-xs text-muted-foreground">Enregistrez d'abord, puis publiez : un quiz en brouillon n'est visible que de vous.</p>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Supprimer ce quiz ?" description="Le quiz et ses questions seront supprimés définitivement. Cette action est impossible dès qu'un étudiant l'a passé."
        confirmLabel="Supprimer" destructive onConfirm={() => authoring.remove.mutate(quizId!, { onSuccess: () => { toast.success("Quiz supprimé"); void navigate({ to: "/formations/$id", params: { id: courseId } }); } })} />
    </div>
  );
}
