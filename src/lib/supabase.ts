import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

/**
 * Client Supabase du navigateur. Il n'existe que côté client : la session est conservée dans le
 * stockage local du navigateur, donc rien n'est connu du rendu serveur (SSR) — les gardes de route
 * sont des gardes d'interface (voir auth.tsx) ; la sécurité réelle est la RLS côté base.
 *
 * Compromis assumé : un jeton dans localStorage est lisible par un script injecté (XSS). La CSP
 * posée dans server.ts en réduit l'exfiltration (connect-src borné à ton projet) sans l'empêcher.
 */
let client: SupabaseClient | null = null;

const REMEMBER_KEY = "cm-remember";

/**
 * « Rester connecté » : coché (défaut) -> la session survit à la fermeture du navigateur (localStorage) ;
 * décoché -> elle ne vit que dans l'onglet (sessionStorage). À appeler AVANT signInWithPassword.
 */
export function setRememberMe(remember: boolean): void {
  try {
    window.localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
  } catch {
    /* stockage indisponible (navigation privée stricte) : la session restera en mémoire de l'onglet */
  }
}

function rememberMe(): boolean {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) !== "0";
  } catch {
    return true;
  }
}

const sessionStorageAdapter = {
  getItem(key: string): string | null {
    try {
      return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      const keep = rememberMe() ? window.localStorage : window.sessionStorage;
      const drop = rememberMe() ? window.sessionStorage : window.localStorage;
      keep.setItem(key, value);
      drop.removeItem(key);
    } catch {
      /* quota ou stockage indisponible : on laisse l'appelant continuer sans persistance */
    }
  },
  removeItem(key: string): void {
    try {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    } catch {
      /* rien à nettoyer */
    }
  },
};

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export function getSupabase(): SupabaseClient | null {
  if (typeof window === "undefined" || !isSupabaseConfigured) return null;
  client ??= createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Aucun lien magique ni OAuth : les codes à 6 chiffres sont saisis à la main.
      detectSessionInUrl: false,
      storageKey: "cm-auth",
      storage: sessionStorageAdapter,
    },
  });
  return client;
}

/** Variante qui échoue explicitement : pour les appels déclenchés par l'utilisateur dans le navigateur. */
export function requireSupabase(): SupabaseClient {
  const c = getSupabase();
  if (!c) throw new ConfigError();
  return c;
}

export class ConfigError extends Error {
  constructor() {
    super(
      "Supabase n'est pas configuré : définir VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (voir .env.example).",
    );
    this.name = "ConfigError";
  }
}
