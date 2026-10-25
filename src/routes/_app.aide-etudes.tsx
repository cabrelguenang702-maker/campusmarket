import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/cm/forms";
import { PageHeader } from "@/components/layout/PageHeader";
import { StudyQuiz } from "@/components/study/StudyQuiz";
import { Copy, RefreshCw, Send, Sparkles } from "@/components/icons";
import { friendlyError } from "@/lib/api/errors";
import { useEnrolledCourses } from "@/lib/api/study-groups";
import { MAX_MESSAGE, useAskStudy, type HistoryTurn, type QuizQuestion, type StudyMode } from "@/lib/api/study-assistant";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/aide-etudes")({
  head: () => ({ meta: [{ title: "Aide aux études — CampusMarket" }, { name: "description", content: "Faites-vous expliquer une notion, résumer un cours ou tester avec un quiz, avec l'assistant d'étude." }] }),
  component: StudyAssistantPage,
});

const MODES: { id: StudyMode; label: string; hint: string; placeholder: string }[] = [
  { id: "explain", label: "Expliquer", hint: "Une notion expliquée pas à pas, avec un exemple.", placeholder: "Ex. : Qu'est-ce que l'élasticité-prix de la demande ?" },
  { id: "summarize", label: "Résumer", hint: "Collez un texte de cours : vous obtenez 5 à 8 points clés.", placeholder: "Collez ici le texte à résumer…" },
  { id: "quiz", label: "Quiz", hint: "Un QCM pour vous tester sur un sujet ou un texte.", placeholder: "Ex. : La Révolution industrielle en Europe" },
  { id: "chat", label: "Questions", hint: "Posez une question, puis poursuivez la discussion.", placeholder: "Posez votre question…" },
];
const NO_COURSE = "none";
type Turn = HistoryTurn;

function StudyAssistantPage() {
  const { session } = useAuth();
  const courses = useEnrolledCourses(session?.user.id);
  const ask = useAskStudy();
  const [mode, setMode] = useState<StudyMode>("explain");
  const [courseId, setCourseId] = useState(NO_COURSE);
  const [text, setText] = useState("");
  const [count, setCount] = useState("5");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [quiz, setQuiz] = useState<QuizQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const current = MODES.find((m) => m.id === mode)!;
  const conversational = mode === "explain" || mode === "chat";

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [turns, ask.isPending]);

  const switchMode = (m: StudyMode) => { if (m === mode) return; setMode(m); setTurns([]); setQuiz(null); setError(null); setText(""); ask.reset(); };
  const reset = () => { setTurns([]); setQuiz(null); setError(null); setText(""); ask.reset(); };

  const submit = async () => {
    const message = text.trim();
    if (!message || ask.isPending) return;
    setError(null);
    const history = conversational ? turns : [];
    try {
      const res = await ask.mutateAsync({ mode, message, history, courseId: courseId === NO_COURSE ? null : courseId, count: Number(count) });
      if ("quiz" in res) { setQuiz(res.quiz); }
      else if (conversational) { setTurns((t) => [...t, { role: "user", text: message }, { role: "model", text: res.reply }]); }
      else { setTurns([{ role: "user", text: message }, { role: "model", text: res.reply }]); }
      setText("");
    } catch (e) { setError(friendlyError(e, "L'assistant n'a pas pu répondre. Réessayez dans un instant.")); }
  };

  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast.success("Copié"); } catch { toast.error("Copie impossible"); } };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader kicker="Campus Academy" title="Aide aux études" description="Un assistant pour comprendre, résumer et réviser. Il vous aide à apprendre, il ne remplace pas votre travail."
        breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Formations", to: "/formations" }, { label: "Aide aux études" }]} />

      <div role="tablist" aria-label="Type d'aide" className="mb-2 inline-flex flex-wrap rounded-lg border border-border bg-secondary p-1">
        {MODES.map((m) => (
          <button key={m.id} role="tab" aria-selected={mode === m.id} onClick={() => switchMode(m.id)}
            className={cn("rounded-md px-3.5 py-1.5 text-sm font-semibold", mode === m.id ? "bg-card shadow-soft" : "text-muted-foreground")}>{m.label}</button>
        ))}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{current.hint}</p>

      {(courses.data?.length ?? 0) > 0 && (
        <div className="mb-4 max-w-sm">
          <Field label="Cours concerné (facultatif)" htmlFor="study-course" hint="L'assistant s'appuiera sur le titre et le plan de la formation.">
            <Select value={courseId} onValueChange={setCourseId}>
              <SelectTrigger id="study-course"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COURSE}>Aucun</SelectItem>
                {courses.data!.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}

      {quiz ? (
        <StudyQuiz key={quiz.map((q) => q.question).join("|")} questions={quiz} onRestart={reset} />
      ) : (
        <>
          {turns.length > 0 && (
            <ul className="mb-4 space-y-3" aria-live="polite">
              {turns.map((t, i) => (
                <li key={i} className={cn("rounded-xl border p-3 text-sm", t.role === "user" ? "ml-8 border-primary/30 bg-primary/10" : "mr-8 border-border bg-card")}>
                  {t.role === "model" && <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground"><Sparkles className="size-3.5" /> Assistant d'étude</p>}
                  <p className="whitespace-pre-wrap">{t.text}</p>
                  {t.role === "model" && <button type="button" onClick={() => void copy(t.text)} className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Copy className="size-3.5" /> Copier</button>}
                </li>
              ))}
              {ask.isPending && <li className="mr-8 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">L'assistant réfléchit…</li>}
              <div ref={endRef} />
            </ul>
          )}

          <div className="space-y-3">
            <Textarea aria-label={current.label} value={text} onChange={(e) => setText(e.target.value.slice(0, MAX_MESSAGE))} rows={mode === "summarize" ? 10 : 4} placeholder={current.placeholder}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit(); }} />
            <div className="flex flex-wrap items-center gap-3">
              {mode === "quiz" && (
                <Select value={count} onValueChange={setCount}>
                  <SelectTrigger aria-label="Nombre de questions" className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>{["3", "5", "8", "10"].map((n) => <SelectItem key={n} value={n}>{n} questions</SelectItem>)}</SelectContent>
                </Select>
              )}
              <Button onClick={() => void submit()} disabled={!text.trim() || ask.isPending}>
                <Send /> {ask.isPending ? "Un instant…" : mode === "quiz" ? "Créer le quiz" : mode === "summarize" ? "Résumer" : "Envoyer"}
              </Button>
              {turns.length > 0 && <Button variant="outline" onClick={reset}><RefreshCw /> Recommencer</Button>}
              <span className="ml-auto text-xs text-muted-foreground">{text.length}/{MAX_MESSAGE}</span>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">20 demandes par jour. Les réponses peuvent contenir des erreurs : vérifiez-les avec votre cours. Rien n'est enregistré.</p>
          </div>
        </>
      )}
    </div>
  );
}
