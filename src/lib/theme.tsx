import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "cm-theme";
const DEFAULT_MODE: ThemeMode = "dark";

/** Script injecté dans <head> : applique le thème AVANT le premier rendu (pas de flash). */
export const themeInitScript = `(function(){try{var m=localStorage.getItem("${STORAGE_KEY}")||"${DEFAULT_MODE}";var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})();`;

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(resolved: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_MODE);
  const [systemDark, setSystemDark] = useState(true);

  // Lecture du choix enregistré (après hydratation pour rester cohérent avec le SSR)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "light" || saved === "dark" || saved === "system") setModeState(saved);
    } catch {
      /* stockage indisponible : on garde le thème par défaut */
    }
    setSystemDark(systemPrefersDark());
  }, []);

  // Suivi du thème système (mode « automatique »)
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolved: "light" | "dark" = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme doit être utilisé dans <ThemeProvider>");
  return ctx;
}

/**
 * Vrai uniquement une fois hydraté côté client. Sert à afficher l'état du thème sans
 * décalage d'hydratation (le SSR ne connaît pas le choix enregistré dans localStorage).
 */
export function useIsClient() {
  return useSyncExternalStore(() => () => {}, () => true, () => false);
}

/** Thème tel que l'utilisateur le voit, cohérent avec le rendu serveur pendant l'hydratation. */
export function useThemeState() {
  const { mode, resolved, setMode } = useTheme();
  const client = useIsClient();
  return { mode: client ? mode : DEFAULT_MODE, resolved: client ? resolved : "dark", setMode } as const;
}
