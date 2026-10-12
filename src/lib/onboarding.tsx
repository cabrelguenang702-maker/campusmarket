import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_COUNTRY, type Country, type University } from "./api/geo";

/**
 * Données saisies pendant l'inscription (conservées entre les écrans du layout _auth). Elles ne vivent
 * qu'en mémoire : un rechargement de page repart de l'étape pays. Le mot de passe n'y est JAMAIS conservé
 * (il est envoyé à Supabase puis oublié) ; le compte, lui, existe dès l'étape e-mail.
 */
type OnboardingState = {
  country: Country;
  setCountry: (c: Country) => void;
  phone: string;
  setPhone: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  university: University | null;
  setUniversity: (u: University | null) => void;
  method: "mtn" | "orange";
  setMethod: (m: "mtn" | "orange") => void;
  /** Identifiant utilisé pour la récupération de mot de passe. */
  resetTarget: string;
  setResetTarget: (v: string) => void;
};

const OnboardingContext = createContext<OnboardingState | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [university, setUniversity] = useState<University | null>(null);
  const [method, setMethod] = useState<"mtn" | "orange">("mtn");
  const [resetTarget, setResetTarget] = useState("");
  const value = useMemo(
    () => ({ country, setCountry, phone, setPhone, email, setEmail, university, setUniversity, method, setMethod, resetTarget, setResetTarget }),
    [country, phone, email, university, method, resetTarget],
  );
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding doit être utilisé dans le layout d'authentification");
  return ctx;
}
