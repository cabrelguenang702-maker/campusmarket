/**
 * Vérification du téléphone pendant l'inscription (le code est envoyé par e-mail tant qu'aucun prestataire SMS
 * n'est branché : voir OTP_DELIVERY côté Edge Functions). `false` : l'étape reste proposée mais peut être
 * passée (et la vérification se fera plus tard). Une étape obligatoire bloquerait toute inscription tant que
 * l'e-mail d'envoi (EMAIL_PROVIDER) n'est pas configuré.
 */
export const PHONE_VERIFICATION_REQUIRED = false;

/** Pays pour lesquels la vérification du téléphone est prise en charge par le backend (regex +237 dans les Edge Functions). */
export const SMS_SUPPORTED_COUNTRIES: readonly string[] = ["CM"];

/** Parcours d'inscription : étapes de la barre de progression. Le paiement d'inscription (si l'admin l'active) a son propre écran, hors barre. */
export const SIGNUP_STEP_COUNT = 4;

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
