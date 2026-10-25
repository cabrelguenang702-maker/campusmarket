/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL du projet Supabase (https://xxxx.supabase.co). Publique. */
  readonly VITE_SUPABASE_URL?: string;
  /** Clé « anon » / publishable du projet. Publique par conception : la RLS protège les données. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Fournisseur de notifications push : "onesignal" | "webpush". Vide : push désactivé. */
  readonly VITE_PUSH_PROVIDER?: string;
  /** Identifiant d'application OneSignal (public). */
  readonly VITE_ONESIGNAL_APP_ID?: string;
  /** Identifiant Safari web OneSignal (public, facultatif : notifications Safari sur Mac). */
  readonly VITE_ONESIGNAL_SAFARI_WEB_ID?: string;
  /** Clé publique VAPID pour le Web Push natif (publique). */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
