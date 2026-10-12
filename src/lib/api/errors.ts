/** Vrai si l'échec vient du réseau (hors ligne, DNS, coupure) plutôt que d'une réponse d'erreur du serveur. */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message =
    error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : "";
  return /failed to fetch|networkerror|load failed|network request failed/i.test(message);
}

type DbError = { code?: string; message?: string };

/**
 * Message affichable pour une erreur Supabase/PostgREST. Les exceptions levées par nos triggers (code P0001)
 * sont déjà rédigées en français pour l'utilisateur (limites de fréquence, règles métier) : on les montre telles quelles.
 */
export function friendlyError(error: unknown, fallback = "Une erreur est survenue. Réessayez dans un instant."): string {
  if (isNetworkError(error)) return "Connexion impossible. Vérifiez votre réseau et réessayez.";
  const e = (typeof error === "object" && error !== null ? error : {}) as DbError;
  if (e.code === "P0001" && e.message) return e.message;
  if (e.code === "42501") return "Action non autorisée avec votre compte actuel.";
  if (e.code === "23505") return "Cette action a déjà été effectuée.";
  if (e.code === "23514" || e.code === "23502") return "Certaines informations sont invalides. Vérifiez le formulaire.";
  return fallback;
}
