import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { UserFacingError } from "./errors";

/* Campus Academy : quiz, tentatives corrigées par le serveur, tableau de progression et badges (migrations 0060 et 0061).
 * Les bonnes réponses ne quittent jamais la base avant la remise d'une tentative. */

const ERRORS: Record<string, string> = {
  forbidden: "Action non autorisée avec votre compte.",
  not_found: "Quiz introuvable ou non accessible : il faut être inscrit à la formation.",
  no_attempts_left: "Vous avez utilisé toutes vos tentatives pour ce quiz.",
  no_questions: "Ce quiz n'a pas encore de question.",
  already_submitted: "Cette tentative a déjà été remise.",
  invalid_status: "Statut invalide.",
  invalid_title: "Le titre doit faire entre 3 et 150 caractères.",
  invalid_pass: "Le seuil de réussite doit être compris entre 0 et 100 %.",
  invalid_attempts: "Le nombre de tentatives doit être compris entre 1 et 50.",
  invalid_time: "La durée doit être comprise entre 1 et 240 minutes.",
  invalid_module: "Ce module n'appartient pas à la formation.",
  invalid_questions: "Un quiz contient de 1 à 50 questions.",
  has_attempts: "Des étudiants ont déjà passé ce quiz : ses questions ne peuvent plus être modifiées ni le quiz supprimé. Passez-le en brouillon ou créez-en un nouveau.",
};

type Json = Record<string, unknown>;
async function rpc<T extends Json = Json>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().rpc(fn, args);
  if (error) {
    if (error.code === "P0001" && error.message) throw new UserFacingError(error.message);
    throw error;
  }
  const r = (data ?? {}) as T & { success?: boolean; error?: string };
  if (!r.success) throw new UserFacingError(ERRORS[r.error ?? ""] ?? "L'action n'a pas pu aboutir.");
  return r;
}

/* ---------- Lecture : quiz d'une formation ---------- */
export type QuizSummary = {
  id: string; courseId: string; moduleId: string | null; title: string; description: string | null; passPercent: number;
  maxAttempts: number | null; timeLimitMinutes: number | null; status: "draft" | "published";
};
type QuizRow = { id: string; course_id: string; module_id: string | null; title: string; description: string | null; pass_percent: number; max_attempts: number | null; time_limit_minutes: number | null; status: "draft" | "published" };
const toQuiz = (r: QuizRow): QuizSummary => ({ id: r.id, courseId: r.course_id, moduleId: r.module_id, title: r.title, description: r.description, passPercent: r.pass_percent, maxAttempts: r.max_attempts, timeLimitMinutes: r.time_limit_minutes, status: r.status });

export function useCourseQuizzes(courseId: string | undefined) {
  return useQuery({
    queryKey: ["academy", "quizzes", courseId],
    enabled: !!courseId && getSupabase() !== null,
    queryFn: async () => {
      const { data, error } = await requireSupabase().from("quizzes").select("id, course_id, module_id, title, description, pass_percent, max_attempts, time_limit_minutes, status").eq("course_id", courseId!).order("created_at");
      if (error) throw error;
      return ((data ?? []) as QuizRow[]).map(toQuiz);
    },
  });
}

export type AttemptRow = { quizId: string; scorePercent: number; passed: boolean; submittedAt: string };
export function useMyAttempts(userId: string | undefined) {
  return useQuery({
    queryKey: ["academy", "attempts", userId],
    enabled: !!userId && getSupabase() !== null,
    queryFn: async () => {
      const { data, error } = await requireSupabase().from("quiz_attempts").select("quiz_id, score_percent, passed, submitted_at").eq("user_id", userId!).not("submitted_at", "is", null).order("submitted_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as { quiz_id: string; score_percent: number; passed: boolean; submitted_at: string }[]).map((r): AttemptRow => ({ quizId: r.quiz_id, scorePercent: r.score_percent, passed: r.passed, submittedAt: r.submitted_at }));
    },
  });
}

export function useIsCourseAuthor(courseId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ["academy", "is-author", courseId, userId],
    enabled: !!courseId && !!userId && getSupabase() !== null,
    queryFn: async () => {
      const { data, error } = await requireSupabase().from("courses").select("id").eq("id", courseId!).eq("instructor_id", userId!).maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });
}

/* ---------- Passer un quiz ---------- */
export type QuizQuestion = { id: string; prompt: string; options: string[]; multiple: boolean };
export type StartedAttempt = { attemptId: string; title: string; passPercent: number; timeLimitMinutes: number | null; startedAt: string; questions: QuizQuestion[] };
export type ReviewItem = { questionId: string; prompt: string; options: string[]; selected: number[]; correct: number[]; explanation: string | null; isCorrect: boolean };
export type AttemptResult = { score: number; passed: boolean; correctCount: number; total: number; timedOut: boolean; passPercent: number; review: ReviewItem[] };

export function useStartAttempt() {
  return useMutation({
    mutationFn: async (quizId: string): Promise<StartedAttempt> => {
      const r = await rpc<{ attempt_id: string; title: string; pass_percent: number; time_limit_minutes: number | null; started_at: string; questions: QuizQuestion[] }>("start_quiz_attempt", { p_quiz_id: quizId });
      return { attemptId: r.attempt_id, title: r.title, passPercent: r.pass_percent, timeLimitMinutes: r.time_limit_minutes, startedAt: r.started_at, questions: r.questions ?? [] };
    },
  });
}

export function useSubmitAttempt(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { attemptId: string; answers: Record<string, number[]> }): Promise<AttemptResult> => {
      const r = await rpc<{ score: number; passed: boolean; correct_count: number; total: number; timed_out: boolean; pass_percent: number; review: { question_id: string; prompt: string; options: string[]; selected: number[]; correct: number[]; explanation: string | null; is_correct: boolean }[] }>("submit_quiz_attempt", { p_attempt_id: v.attemptId, p_answers: v.answers });
      return {
        score: r.score, passed: r.passed, correctCount: r.correct_count, total: r.total, timedOut: r.timed_out, passPercent: r.pass_percent,
        review: (r.review ?? []).map((x) => ({ questionId: x.question_id, prompt: x.prompt, options: x.options, selected: x.selected, correct: x.correct, explanation: x.explanation, isCorrect: x.is_correct })),
      };
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["academy", "attempts", userId] }), qc.invalidateQueries({ queryKey: ["academy", "summary"] }), qc.invalidateQueries({ queryKey: ["notifications"] })]),
  });
}

/* ---------- Auteur : édition ---------- */
export type QuizDraftQuestion = { prompt: string; options: string[]; correct: number[]; explanation: string };
export type QuizDraft = { title: string; description: string; passPercent: number; maxAttempts: number | null; timeLimitMinutes: number | null; moduleId: string | null; shuffle: boolean; status: "draft" | "published"; questions: QuizDraftQuestion[] };

export function useQuizForEdit(quizId: string | undefined) {
  return useQuery({
    queryKey: ["academy", "quiz-edit", quizId],
    enabled: !!quizId && getSupabase() !== null,
    gcTime: 0,
    queryFn: async () => {
      const r = await rpc<{ quiz: QuizRow & { shuffle: boolean; description: string | null }; has_attempts: boolean; questions: { prompt: string; options: string[]; correct: number[]; explanation: string | null }[] }>("load_quiz_for_edit", { p_quiz_id: quizId });
      const draft: QuizDraft = {
        title: r.quiz.title, description: r.quiz.description ?? "", passPercent: r.quiz.pass_percent, maxAttempts: r.quiz.max_attempts, timeLimitMinutes: r.quiz.time_limit_minutes,
        moduleId: r.quiz.module_id, shuffle: r.quiz.shuffle, status: r.quiz.status,
        questions: (r.questions ?? []).map((q) => ({ prompt: q.prompt, options: q.options, correct: q.correct, explanation: q.explanation ?? "" })),
      };
      return { draft, hasAttempts: r.has_attempts };
    },
  });
}

export function useQuizStats(quizId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["academy", "quiz-stats", quizId],
    enabled: !!quizId && enabled && getSupabase() !== null,
    queryFn: async () => {
      const r = await rpc<{ attempts: number; learners: number; avg_score: number | null; pass_rate: number | null }>("quiz_stats", { p_quiz_id: quizId });
      return { attempts: r.attempts, learners: r.learners, avgScore: r.avg_score, passRate: r.pass_rate };
    },
  });
}

export function useQuizAuthoring(courseId: string) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["academy", "quizzes", courseId] }), qc.invalidateQueries({ queryKey: ["academy", "quiz-edit"] }), qc.invalidateQueries({ queryKey: ["academy", "quiz-stats"] })]);
  return {
    save: useMutation({
      /** `withQuestions: false` ne touche pas aux questions (seul moyen de régler un quiz déjà passé par des étudiants). */
      mutationFn: async (v: { quizId: string | null; draft: QuizDraft; withQuestions: boolean }) => {
        const data: Record<string, unknown> = {
          title: v.draft.title, description: v.draft.description, pass_percent: v.draft.passPercent, max_attempts: v.draft.maxAttempts,
          time_limit_minutes: v.draft.timeLimitMinutes, module_id: v.draft.moduleId, shuffle: v.draft.shuffle,
        };
        if (v.withQuestions) data["questions"] = v.draft.questions.map((q) => ({ prompt: q.prompt, options: q.options, correct: q.correct, explanation: q.explanation }));
        const r = await rpc<{ quiz_id: string }>("save_quiz", { p_course_id: courseId, p_quiz_id: v.quizId, p_data: data });
        return r.quiz_id;
      },
      onSuccess: refresh,
    }),
    setStatus: useMutation({
      mutationFn: (v: { quizId: string; status: "draft" | "published" }) => rpc("set_quiz_status", { p_quiz_id: v.quizId, p_status: v.status }),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (quizId: string) => rpc("delete_quiz", { p_quiz_id: quizId }), onSuccess: refresh }),
  };
}

/* ---------- Progression, objectifs, badges ---------- */
export type LearningSummary = {
  lessonsCompleted: number; quizzesAttempted: number; quizzesPassed: number; avgScore: number | null;
  weekLessons: number; weekQuizzes: number; goalLessons: number; goalQuizzes: number;
  courses: { courseId: string; title: string; total: number; done: number; lastActivity: string | null }[];
  byCategory: { slug: string; name: string; attempts: number; avgScore: number | null }[];
  activity: { day: string; count: number }[];
  badges: { code: string; title: string; description: string; rule: string; awardedAt: string | null }[];
};

export function useLearningSummary(userId: string | undefined) {
  return useQuery({
    queryKey: ["academy", "summary", userId],
    enabled: !!userId && getSupabase() !== null,
    queryFn: async (): Promise<LearningSummary> => {
      const r = await rpc<Json>("my_learning_summary", {});
      const n = (v: unknown) => Number(v ?? 0);
      return {
        lessonsCompleted: n(r["lessons_completed"]), quizzesAttempted: n(r["quizzes_attempted"]), quizzesPassed: n(r["quizzes_passed"]),
        avgScore: r["avg_score"] == null ? null : n(r["avg_score"]),
        weekLessons: n(r["week_lessons"]), weekQuizzes: n(r["week_quizzes"]), goalLessons: n(r["goal_lessons"]), goalQuizzes: n(r["goal_quizzes"]),
        courses: ((r["courses"] as Json[]) ?? []).map((c) => ({ courseId: String(c["course_id"]), title: String(c["title"]), total: n(c["total"]), done: n(c["done"]), lastActivity: (c["last_activity"] as string | null) ?? null })),
        byCategory: ((r["by_category"] as Json[]) ?? []).map((c) => ({ slug: String(c["slug"]), name: String(c["name"]), attempts: n(c["attempts"]), avgScore: c["avg_score"] == null ? null : n(c["avg_score"]) })),
        activity: ((r["activity"] as Json[]) ?? []).map((a) => ({ day: String(a["day"]), count: n(a["count"]) })),
        badges: ((r["badges"] as Json[]) ?? []).map((b) => ({ code: String(b["code"]), title: String(b["title"]), description: String(b["description"]), rule: String(b["rule"]), awardedAt: (b["awarded_at"] as string | null) ?? null })),
      };
    },
  });
}

export function useSetGoals(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { weeklyLessons: number; weeklyQuizzes: number }) => {
      const { error } = await requireSupabase().from("learning_goals").upsert({ user_id: userId!, weekly_lessons: v.weeklyLessons, weekly_quizzes: v.weeklyQuizzes }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["academy", "summary", userId] }),
  });
}
