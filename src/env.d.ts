/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL du projet Supabase (https://xxxx.supabase.co). Publique. */
  readonly VITE_SUPABASE_URL?: string;
  /** Clé « anon » / publishable du projet. Publique par conception : la RLS protège les données. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** "true" pour réafficher les barres de bascule d'états sur les écrans encore en maquette. */
  readonly VITE_DESIGN_REVIEW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
