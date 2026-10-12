/**
 * Mode « revue de design » : affiche sur les écrans encore en maquette une barre pour basculer entre
 * les états (chargement, vide, erreur, succès…). Désactivé par défaut ; `VITE_DESIGN_REVIEW=true`
 * le réactive en développement. Les écrans branchés sur Supabase n'ont plus cette barre : leurs états
 * viennent des vraies requêtes.
 */
export const DESIGN_REVIEW_MODE = import.meta.env.VITE_DESIGN_REVIEW === "true";

/**
 * Étape « Paiement de l'inscription » (écran maquette, REGISTRATION_FEE dans mock-data.ts).
 * NE PAS ACTIVER : le backend n'a aucune cible de paiement « inscription au service » (les paiements
 * existants visent une commande, une formation ou un billet) et aucune règle ne conditionne l'accès à
 * un paiement. Activer ce drapeau rétablit l'écran, mais sans aucun effet réel.
 */
export const REGISTRATION_PAYMENT_ENABLED = false;

/**
 * Vérification du téléphone par SMS pendant l'inscription. `false` : l'étape reste proposée mais peut
 * être passée (et la vérification se fera plus tard). Tant qu'aucun prestataire SMS n'est configuré
 * côté Edge Functions (SMS_PROVIDER), une étape obligatoire bloquerait toute inscription.
 */
export const PHONE_VERIFICATION_REQUIRED = false;

/** Pays pour lesquels la vérification SMS est prise en charge par le backend (regex +237 dans les Edge Functions). */
export const SMS_SUPPORTED_COUNTRIES: readonly string[] = ["CM"];

/** Parcours d'inscription : nombre d'étapes affichées dans la barre de progression. */
export const SIGNUP_STEP_COUNT = REGISTRATION_PAYMENT_ENABLED ? 5 : 4;

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
