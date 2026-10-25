import { Button } from "@/components/ui/button";
import { Plus } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { useCourseQuizzes, useIsCourseAuthor, useMyAttempts } from "@/lib/api/quizzes";
import { useAuth } from "@/lib/auth";

/** Quiz d'une formation : les inscrits les passent, l'auteur les gère (y compris les brouillons). */
export function QuizSection({ courseId, enrolled }: { courseId: string; enrolled: boolean }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const quizzes = useCourseQuizzes(courseId);
  const attempts = useMyAttempts(userId);
  const author = useIsCourseAuthor(courseId, userId).data === true;
  const list = quizzes.data ?? [];
  if (!author && (!enrolled || list.length === 0)) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-label="Quiz de la formation">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold">Quiz</h2>
        <div className="flex gap-2">
          {enrolled && <Button asChild variant="outline" size="sm"><AppLink to="/progression">Ma progression</AppLink></Button>}
          {author && <Button asChild size="sm"><AppLink to={`/formations/${courseId}/quiz-editeur/nouveau`}><Plus /> Nouveau quiz</AppLink></Button>}
        </div>
      </div>
      {list.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Aucun quiz pour l'instant.</p> : (
        <ul className="mt-3 divide-y divide-border">
          {list.map((q) => {
            const mine = (attempts.data ?? []).filter((a) => a.quizId === q.id);
            const best = mine.reduce<number | null>((m, a) => (m === null || a.scorePercent > m ? a.scorePercent : m), null);
            const passed = mine.some((a) => a.passed);
            return (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">{q.title}{q.status === "draft" && <Pill tone="neutral">Brouillon</Pill>}{passed && <Pill tone="success">Réussi</Pill>}</p>
                  <p className="text-xs text-muted-foreground">Seuil {q.passPercent} %{q.timeLimitMinutes ? ` · ${q.timeLimitMinutes} min` : ""}{best !== null ? ` · meilleur score ${best} %` : ""}</p>
                </div>
                <div className="flex gap-2">
                  {enrolled && q.status === "published" && <Button asChild size="sm"><AppLink to={`/formations/${courseId}/quiz/${q.id}`}>{mine.length ? "Repasser" : "Commencer"}</AppLink></Button>}
                  {author && <Button asChild size="sm" variant="outline"><AppLink to={`/formations/${courseId}/quiz-editeur/${q.id}`}>Gérer</AppLink></Button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
