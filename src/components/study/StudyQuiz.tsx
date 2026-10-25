import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { QuizQuestion } from "@/lib/api/study-assistant";

/** Quiz d'entraînement généré par l'IA : correction côté écran (le serveur renvoie la bonne réponse), rien n'est enregistré. */
export function StudyQuiz({ questions, onRestart }: { questions: QuizQuestion[]; onRestart: () => void }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [done, setDone] = useState(false);
  const answered = Object.keys(answers).length;
  const score = questions.filter((q, i) => answers[i] === q.answerIndex).length;

  return (
    <div className="space-y-4">
      {done && (
        <div role="status" className="rounded-xl border border-border bg-secondary p-4 text-center">
          <p className="text-2xl font-extrabold">{score} / {questions.length}</p>
          <p className="text-sm text-muted-foreground">{score === questions.length ? "Parfait !" : score >= questions.length / 2 ? "Bien joué, relisez les explications ci-dessous." : "Relisez les explications puis réessayez."}</p>
        </div>
      )}
      <ol className="space-y-4">
        {questions.map((q, qi) => (
          <li key={qi} className="rounded-xl border border-border bg-card p-4">
            <p className="mb-3 font-semibold">{qi + 1}. {q.question}</p>
            <div className="space-y-2" role="radiogroup" aria-label={`Question ${qi + 1}`}>
              {q.options.map((opt, oi) => {
                const picked = answers[qi] === oi;
                const right = done && oi === q.answerIndex;
                const wrong = done && picked && oi !== q.answerIndex;
                return (
                  <button key={oi} type="button" role="radio" aria-checked={picked} disabled={done}
                    onClick={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                    className={cn("flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition",
                      picked && !done && "border-primary bg-primary/10", right && "border-green-600 bg-green-600/10", wrong && "border-destructive bg-destructive/10", !picked && !right && "border-border hover:bg-secondary")}>
                    <span className="flex-1">{opt}</span>
                    {right && <Check className="size-4 text-green-600" aria-label="Bonne réponse" />}
                    {wrong && <X className="size-4 text-destructive" aria-label="Réponse fausse" />}
                  </button>
                );
              })}
            </div>
            {done && q.explanation && <p className="mt-3 text-sm text-muted-foreground">{q.explanation}</p>}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        {!done && <Button onClick={() => setDone(true)} disabled={answered < questions.length}>Corriger ({answered}/{questions.length})</Button>}
        <Button variant="outline" onClick={onRestart}>{done ? "Nouveau quiz" : "Annuler"}</Button>
      </div>
    </div>
  );
}
