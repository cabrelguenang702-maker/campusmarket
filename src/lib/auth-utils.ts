/**
 * Utilitaires d'authentification purs (aucune dépendance) : testables avec `node --test`
 * (voir auth-utils.test.ts) sans navigateur ni Supabase.
 */

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim()) && value.trim().length <= 254;
}

/** Règles de mot de passe, affichées telles quelles à l'utilisateur (inscription ET réinitialisation). */
export const PASSWORD_RULES = [
  { label: "10 caractères minimum", test: (p: string) => p.length >= 10 },
  { label: "Une majuscule", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Un chiffre", test: (p: string) => /[0-9]/.test(p) },
] as const;

export function passwordRuleResults(password: string): { label: string; ok: boolean }[] {
  return PASSWORD_RULES.map((r) => ({ label: r.label, ok: r.test(password) }));
}

export function isStrongPassword(password: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(password));
}

/** Un identifiant ressemble à une adresse e-mail dès qu'il contient un @. */
export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes("@");
}

/**
 * Numéro international E.164 à partir de l'indicatif du pays et de la saisie.
 * Tolère espaces, tirets, points, parenthèses, l'indicatif déjà saisi (avec + ou 00) et un 0 de tête
 * (« 6 12 34 56 78 » et « 0612345678 » donnent le même numéro). Renvoie null si la saisie ne contient
 * aucun chiffre exploitable.
 */
export function toE164(dialCode: string, input: string): string | null {
  const dial = dialCode.replace(/\D/g, "");
  let digits = input.replace(/\D/g, "");
  if (!digits) return null;
  if (input.trim().startsWith("+") && digits.startsWith(dial)) digits = digits.slice(dial.length);
  else if (digits.startsWith("00" + dial)) digits = digits.slice(2 + dial.length);
  digits = digits.replace(/^0+/, "");
  if (!digits) return null;
  return `+${dial}${digits}`;
}

/** Même contrôle que les Edge Functions (PHONE_REGEX) : mobile camerounais +237 6xx ou 2xx, 9 chiffres. */
export const CM_PHONE_REGEX = /^\+237[26]\d{8}$/;

export function isCameroonMobile(e164: string): boolean {
  return CM_PHONE_REGEX.test(e164);
}

/** Affichage lisible : +237 6 12 34 56 78. */
export function formatCameroonPhone(e164: string): string {
  const m = /^\+237(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+237 ${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` : e164;
}

export type AuthErrorKind =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "already_registered"
  | "rate_limited"
  | "code_invalid_or_expired"
  | "weak_password"
  | "same_password"
  | "signup_disabled"
  | "network"
  | "not_configured"
  | "unknown";

type ErrorLike =
  { name?: string; code?: string; status?: number; message?: string } | null | undefined;

/**
 * Traduit une erreur Supabase Auth en une catégorie d'interface. S'appuie d'abord sur `code` (stable),
 * puis sur le statut HTTP ; le texte du message n'est qu'un dernier recours (il change d'une version à l'autre).
 *
 * Note : Supabase ne distingue pas « code faux » et « code expiré » (même code otp_expired) : l'écran
 * affiche donc un message unique « incorrect ou expiré ».
 */
export function classifyAuthError(error: ErrorLike): AuthErrorKind {
  if (!error) return "unknown";
  if (error.name === "ConfigError") return "not_configured";
  if (error.name === "AuthRetryableFetchError" || error.name === "TypeError" || error.status === 0)
    return "network";

  switch (error.code) {
    case "invalid_credentials":
      return "invalid_credentials";
    case "email_not_confirmed":
      return "email_not_confirmed";
    case "user_already_exists":
    case "email_exists":
      return "already_registered";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
    case "over_sms_send_rate_limit":
      return "rate_limited";
    case "otp_expired":
    case "otp_disabled":
      return "code_invalid_or_expired";
    case "weak_password":
      return "weak_password";
    case "same_password":
      return "same_password";
    case "signup_disabled":
    case "email_provider_disabled":
      return "signup_disabled";
  }
  if (error.status === 429) return "rate_limited";
  if (error.status === 400 && /invalid login/i.test(error.message ?? ""))
    return "invalid_credentials";
  if (error.status === 400 && /token has expired|invalid/i.test(error.message ?? ""))
    return "code_invalid_or_expired";
  return "unknown";
}

/**
 * Chemins réservés aux visiteurs : un utilisateur déjà connecté en est renvoyé vers l'accueil.
 *
 * `/inscription/email` et `/inscription/otp-email` n'en font volontairement PAS partie : la session
 * s'ouvre PENDANT ces écrans (à la validation du code, ou dès l'inscription si le projet n'exige pas
 * la confirmation d'e-mail). Une redirection automatique vers l'accueil couperait le parcours avant
 * l'étape suivante (téléphone, université). Ces deux écrans gèrent eux-mêmes le cas « déjà connecté ».
 */
export const GUEST_ONLY_PATHS: readonly string[] = [
  "/bienvenue",
  "/connexion",
  "/mot-de-passe-oublie",
  "/inscription/pays",
];

export function isGuestOnlyPath(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return GUEST_ONLY_PATHS.includes(p);
}

/** Rôles du back-office (miroir de is_staff() côté base : moderator, support, admin, super_admin). */
export const STAFF_ROLES: readonly string[] = ["moderator", "support", "admin", "super_admin"];
export const BACK_OFFICE_ROLES: readonly string[] = [...STAFF_ROLES, "financial_manager"];

export function hasAnyRole(roles: readonly string[], wanted: readonly string[]): boolean {
  return roles.some((r) => wanted.includes(r));
}

export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}

/**
 * Chemin de retour après connexion, issu d'un paramètre ou du stockage : uniquement un chemin interne
 * (commence par un seul « / », ni « // » ni « /\\ », pas de schéma). Tout le reste est ignoré :
 * sinon /connexion?redirect=https://site-pirate devient une redirection ouverte (hameçonnage).
 */
export function safeRedirectPath(candidate: string | null | undefined, fallback = "/"): string {
  if (!candidate) return fallback;
  if (candidate.length > 500) return fallback;
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
  for (let i = 0; i < candidate.length; i++) {
    const code = candidate.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return fallback; // caractères de contrôle : injection d'en-têtes
  }
  if (
    /^\/(connexion|bienvenue|inscription|mot-de-passe-oublie|reinitialisation)(\/|$|\?)/.test(
      candidate,
    )
  )
    return fallback;
  return candidate;
}
