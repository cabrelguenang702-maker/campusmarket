import { useMutation } from "@tanstack/react-query";
import { invokeFunction } from "./functions";
import { UserFacingError } from "./errors";

/* Aide aux études : action « study » de l'Edge Function campus-copilot (Gemini).
 * Modes : explain (expliquer), summarize (résumer), quiz (QCM), chat (questions).
 * Rien n'est sauvegardé côté serveur : la conversation vit dans l'écran. Quota : 20 demandes par jour et par étudiant. */

export type StudyMode = "explain" | "summarize" | "quiz" | "chat";
export const MAX_MESSAGE = 8000;
export type HistoryTurn = { role: "user" | "model"; text: string };
export type QuizQuestion = { question: string; options: string[]; answerIndex: number; explanation: string };

export const STUDY_ERRORS: Record<string, string> = {
  rate_limited_user: "Vous avez atteint votre limite de 20 demandes par jour. Revenez demain.",
  rate_limited_global: "L'assistant est très sollicité aujourd'hui. Réessayez un peu plus tard.",
  quota_exceeded: "L'assistant est momentanément saturé. Réessayez dans quelques minutes.",
  quiz_generation_failed: "Le quiz n'a pas pu être généré. Reformulez le sujet ou réessayez.",
  copilot_not_configured: "L'assistant n'est pas encore disponible.",
  invalid_message: `Le message est vide ou dépasse ${MAX_MESSAGE} caractères.`,
  unauthorized: "Session expirée : reconnectez-vous.",
};

type Input = { mode: StudyMode; message: string; history?: HistoryTurn[]; courseId?: string | null; count?: number };
export type StudyResult = { reply: string } | { quiz: QuizQuestion[] };

async function askStudy(input: Input): Promise<StudyResult> {
  const res = await invokeFunction<{ reply?: string; quiz?: { questions?: { question: string; options: string[]; answer_index: number; explanation: string }[] } }>("campus-copilot", {
    action: "study", mode: input.mode, message: input.message,
    ...(input.history?.length ? { history: input.history } : {}),
    ...(input.courseId ? { courseId: input.courseId } : {}),
    ...(input.mode === "quiz" && input.count ? { count: input.count } : {}),
  });
  if (!res.ok) {
    if (res.kind === "network") throw new UserFacingError("Connexion impossible. Vérifiez votre réseau et réessayez.");
    if (res.kind === "not_configured") throw new UserFacingError(STUDY_ERRORS["copilot_not_configured"]!);
    throw new UserFacingError(STUDY_ERRORS[res.code] ?? "L'assistant n'a pas pu répondre. Réessayez dans un instant.");
  }
  if (input.mode === "quiz") {
    const questions = (res.data.quiz?.questions ?? []).map((q) => ({ question: q.question, options: q.options, answerIndex: q.answer_index, explanation: q.explanation }));
    if (questions.length === 0) throw new UserFacingError(STUDY_ERRORS["quiz_generation_failed"]!);
    return { quiz: questions };
  }
  return { reply: res.data.reply ?? "" };
}

export const useAskStudy = () => useMutation({ mutationFn: askStudy });
