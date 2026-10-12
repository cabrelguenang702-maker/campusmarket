import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured, requireSupabase, setRememberMe } from "./supabase";
import { fetchOwnAccount, type OwnAccount } from "./api/profile";
import { recordLogin } from "./api/security";
import {
  BACK_OFFICE_ROLES,
  STAFF_ROLES,
  classifyAuthError,
  hasAnyRole,
  isGuestOnlyPath,
  safeRedirectPath,
  type AuthErrorKind,
} from "./auth-utils";
import { Spinner } from "@/components/cm/feedback";
import { ServerErrorScreen } from "@/components/cm/screens";
import { DeactivatedScreen } from "@/components/auth/DeactivatedScreen";
import { MfaChallengeScreen } from "@/components/auth/MfaChallengeScreen";

/* -------------------------------------------------------------------------------------------------
 * Authentification Supabase côté navigateur.
 *
 * Les gardes ci-dessous sont des gardes d'INTERFACE : elles évitent d'afficher un écran à quelqu'un qui
 * ne devrait pas le voir, mais ne protègent aucune donnée. La protection réelle est la RLS (et les
 * fonctions admin_* qui revérifient rôle et MFA). Un utilisateur qui contourne la garde obtient un écran
 * vide, jamais des données.
 * ------------------------------------------------------------------------------------------------- */

/** `mfa_required` : mot de passe accepté, mais le compte a la double authentification et le code n'a pas encore été saisi
 *  (la session est aal1). Tant que c'est le cas, la base refuse l'accès aux données (politique mfa_required, 0039). */
export type AuthStatus = "loading" | "anonymous" | "authenticated" | "mfa_required" | "unconfigured";
export type AccountStatus = "idle" | "loading" | "ready" | "error";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; kind: AuthErrorKind };

type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  account: OwnAccount | null;
  accountStatus: AccountStatus;
  roles: string[];
  isStaff: boolean;
  hasBackOffice: boolean;
  refreshAccount: () => Promise<void>;

  signIn: (email: string, password: string, remember: boolean) => Promise<ActionResult>;
  signUp: (input: {
    email: string;
    password: string;
    fullName: string;
  }) => Promise<ActionResult<{ needsEmailCode: boolean }>>;
  verifyEmailCode: (email: string, code: string) => Promise<ActionResult>;
  resendEmailCode: (email: string) => Promise<ActionResult>;
  requestPasswordReset: (email: string) => Promise<ActionResult>;
  verifyRecoveryCode: (email: string, code: string) => Promise<ActionResult>;
  updatePassword: (password: string) => Promise<ActionResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const POST_LOGIN_KEY = "cm-after-login";
export const SESSION_EXPIRED_KEY = "cm-session-expired";

function fail(error: unknown): { ok: false; kind: AuthErrorKind } {
  return {
    ok: false,
    kind: classifyAuthError(
      error as { name?: string; code?: string; status?: number; message?: string },
    ),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [sessionStatus, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  // Niveau d'assurance : un code TOTP est-il encore à saisir pour CET utilisateur ? (uid = pour qui la vérification a été faite)
  const [mfa, setMfa] = useState<{ uid: string | null; pending: boolean }>({ uid: null, pending: false });
  const [account, setAccount] = useState<OwnAccount | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>("idle");
  // Évite qu'une réponse tardive d'un ancien utilisateur écrase le compte du nouveau.
  const loadSeq = useRef(0);
  // Distingue une déconnexion voulue d'une session perdue (jeton de rafraîchissement refusé, révocation).
  const signingOut = useRef(false);
  const wasAuthenticated = useRef(false);

  // 1. Session : lecture initiale puis abonnement aux changements.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setStatus(isSupabaseConfigured ? "loading" : "unconfigured");
      return;
    }
    let active = true;

    void sb.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setStatus(data.session ? "authenticated" : "anonymous");
    });

    // Callback volontairement synchrone et sans appel Supabase : appeler le client depuis ce callback
    // peut provoquer un interblocage (comportement documenté de supabase-js).
    const { data: sub } = sb.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      if (event === "SIGNED_OUT" && wasAuthenticated.current && !signingOut.current) {
        try {
          window.sessionStorage.setItem(SESSION_EXPIRED_KEY, "1");
        } catch {
          /* le message « session expirée » sera simplement absent */
        }
      }
      wasAuthenticated.current = next !== null;
      setSession(next);
      setStatus(next ? "authenticated" : "anonymous");
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 1 bis. Double authentification : lecture locale du niveau (aal1/aal2) de la session. Relancée à chaque changement de
  //    session : la saisie du code renouvelle le jeton, ce qui fait passer l'état à « authentifié ».
  useEffect(() => {
    const sb = getSupabase();
    const uid = session?.user.id ?? null;
    if (!sb || !uid) {
      setMfa({ uid: null, pending: false });
      return;
    }
    let active = true;
    void sb.auth.mfa
      .getAuthenticatorAssuranceLevel()
      .then(({ data }) => {
        if (!active) return;
        setMfa({ uid, pending: Boolean(data && data.nextLevel === "aal2" && data.currentLevel !== "aal2") });
      })
      .catch(() => {
        // En cas d'échec de lecture on ne bloque pas l'interface : la base reste le garde-fou (elle refuse les données).
        if (active) setMfa({ uid, pending: false });
      });
    return () => {
      active = false;
    };
  }, [session]);

  const status: AuthStatus =
    sessionStatus === "authenticated" && session
      ? mfa.uid !== session.user.id
        ? "loading"
        : mfa.pending
          ? "mfa_required"
          : "authenticated"
      : sessionStatus;

  // 2. Compte (profil, données privées, rôles) : rechargé quand l'utilisateur change, pas à chaque
  //    renouvellement de jeton. Rien n'est chargé tant que le code de double authentification manque.
  const userId = status === "authenticated" ? (session?.user.id ?? null) : null;

  const loadAccount = useCallback(async (id: string) => {
    const seq = ++loadSeq.current;
    setAccountStatus("loading");
    try {
      const next = await fetchOwnAccount(id);
      if (seq !== loadSeq.current) return;
      setAccount(next);
      setAccountStatus("ready");
    } catch (error) {
      if (seq !== loadSeq.current) return;
      console.error("Chargement du compte impossible", error);
      setAccountStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      loadSeq.current++;
      setAccount(null);
      setAccountStatus("idle");
      return;
    }
    void loadAccount(userId);
  }, [userId, loadAccount]);

  const refreshAccount = useCallback(async () => {
    if (userId) await loadAccount(userId);
  }, [userId, loadAccount]);

  // 3. Actions.
  const signIn = useCallback<AuthContextValue["signIn"]>(async (email, password, remember) => {
    try {
      setRememberMe(remember);
      const { error } = await requireSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) return fail(error);
      // Journal de connexion et détection de nouvel appareil : sans effet sur la connexion si l'appel échoue.
      // Avec la double authentification, la connexion n'est consignée qu'une fois le code saisi (écran de vérification).
      const level = await requireSupabase().auth.mfa.getAuthenticatorAssuranceLevel();
      if (!(level.data && level.data.nextLevel === "aal2" && level.data.currentLevel !== "aal2")) void recordLogin();
      return { ok: true };
    } catch (error) {
      return fail(error);
    }
  }, []);

  const signUp = useCallback<AuthContextValue["signUp"]>(async ({ email, password, fullName }) => {
    try {
      setRememberMe(true);
      const { data, error } = await requireSupabase().auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: fullName.trim() } },
      });
      if (error) return fail(error);
      // Avec la confirmation d'e-mail activée, Supabase répond sans erreur pour une adresse déjà inscrite
      // (anti-énumération) mais renvoie un utilisateur SANS identité : c'est le signal documenté.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return { ok: false, kind: "already_registered" };
      }
      return { ok: true, needsEmailCode: data.session === null };
    } catch (error) {
      return fail(error);
    }
  }, []);

  const verifyEmailCode = useCallback<AuthContextValue["verifyEmailCode"]>(async (email, code) => {
    try {
      const { error } = await requireSupabase().auth.verifyOtp({
        email: email.trim(),
        token: code,
        type: "signup",
      });
      return error ? fail(error) : { ok: true };
    } catch (error) {
      return fail(error);
    }
  }, []);

  const resendEmailCode = useCallback<AuthContextValue["resendEmailCode"]>(async (email) => {
    try {
      const { error } = await requireSupabase().auth.resend({
        type: "signup",
        email: email.trim(),
      });
      return error ? fail(error) : { ok: true };
    } catch (error) {
      return fail(error);
    }
  }, []);

  const requestPasswordReset = useCallback<AuthContextValue["requestPasswordReset"]>(
    async (email) => {
      try {
        const { error } = await requireSupabase().auth.resetPasswordForEmail(email.trim());
        return error ? fail(error) : { ok: true };
      } catch (error) {
        return fail(error);
      }
    },
    [],
  );

  const verifyRecoveryCode = useCallback<AuthContextValue["verifyRecoveryCode"]>(
    async (email, code) => {
      try {
        const { error } = await requireSupabase().auth.verifyOtp({
          email: email.trim(),
          token: code,
          type: "recovery",
        });
        return error ? fail(error) : { ok: true };
      } catch (error) {
        return fail(error);
      }
    },
    [],
  );

  const updatePassword = useCallback<AuthContextValue["updatePassword"]>(async (password) => {
    try {
      const sb = requireSupabase();
      const { error } = await sb.auth.updateUser({ password });
      if (error) return fail(error);
      // Un mot de passe réinitialisé invalide TOUTES les sessions (y compris celle d'un éventuel intrus),
      // puis l'écran de succès renvoie vers la connexion. Déconnexion voulue : pas de « session expirée ».
      signingOut.current = true;
      try {
        await sb.auth.signOut({ scope: "global" });
      } finally {
        signingOut.current = false;
      }
      return { ok: true };
    } catch (error) {
      return fail(error);
    }
  }, []);

  const signOut = useCallback(async () => {
    signingOut.current = true;
    try {
      await getSupabase()?.auth.signOut();
    } finally {
      signingOut.current = false;
      // Rien du compte précédent ne doit rester dans le cache de requêtes.
      queryClient.clear();
      try {
        window.sessionStorage.removeItem(POST_LOGIN_KEY);
      } catch {
        /* sans importance */
      }
    }
  }, [queryClient]);

  const roles = account?.roles ?? [];
  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      account,
      accountStatus,
      roles,
      isStaff: hasAnyRole(roles, STAFF_ROLES),
      hasBackOffice: hasAnyRole(roles, BACK_OFFICE_ROLES),
      refreshAccount,
      signIn,
      signUp,
      verifyEmailCode,
      resendEmailCode,
      requestPasswordReset,
      verifyRecoveryCode,
      updatePassword,
      signOut,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roles dérive de account
    [
      status,
      session,
      account,
      accountStatus,
      refreshAccount,
      signIn,
      signUp,
      verifyEmailCode,
      resendEmailCode,
      requestPasswordReset,
      verifyRecoveryCode,
      updatePassword,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- le hook accompagne son fournisseur
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé sous <AuthProvider>");
  return ctx;
}

/* ------------------------------------------------------------------------------------------------
 * Gardes de route (interface uniquement — voir l'avertissement en tête de fichier)
 * ---------------------------------------------------------------------------------------------- */

function FullScreenLoader({ label = "Chargement…" }: { label?: string }) {
  return (
    <div
      className="grid min-h-screen place-items-center bg-background"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Spinner /> {label}
      </div>
    </div>
  );
}

function ConfigMissingScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="max-w-md rounded-lg border border-border bg-card p-6 text-sm">
        <h1 className="font-display text-lg font-bold">Supabase n'est pas configuré</h1>
        <p className="mt-2 text-muted-foreground">
          Définir <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_ANON_KEY</code> dans le
          fichier <code>.env</code>
          (modèle : <code>.env.example</code>), puis relancer le serveur.
        </p>
      </div>
    </div>
  );
}

/** Pages réservées aux utilisateurs connectés. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, account, refreshAccount, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname + (location.searchStr ?? "");

  useEffect(() => {
    if (status !== "anonymous") return;
    try {
      window.sessionStorage.setItem(POST_LOGIN_KEY, safeRedirectPath(path));
    } catch {
      /* sans conséquence : retour à l'accueil après connexion */
    }
    void navigate({ to: "/connexion", replace: true });
  }, [status, navigate, path]);

  if (status === "unconfigured") return <ConfigMissingScreen />;
  if (status === "mfa_required") return <MfaChallengeScreen onSignOut={() => void signOut()} />;
  if (status !== "authenticated") return <FullScreenLoader />;
  if (account?.profile.deactivatedAt) return <DeactivatedScreen onReactivated={refreshAccount} onSignOut={() => void signOut()} />;
  return <>{children}</>;
}

/** Pages d'authentification : un utilisateur déjà connecté est renvoyé vers l'accueil (ou sa page d'origine). */
export function RequireGuest({ children }: { children: ReactNode }) {
  const { status, signOut } = useAuth();
  const router = useRouter();
  const location = useLocation();
  const redirect = status === "authenticated" && isGuestOnlyPath(location.pathname);

  useEffect(() => {
    if (!redirect) return;
    let target = "/";
    try {
      target = safeRedirectPath(window.sessionStorage.getItem(POST_LOGIN_KEY));
      window.sessionStorage.removeItem(POST_LOGIN_KEY);
    } catch {
      /* repli sur l'accueil */
    }
    router.history.replace(target);
  }, [redirect, router]);

  if (status === "unconfigured") return <ConfigMissingScreen />;
  if (status === "mfa_required") return <MfaChallengeScreen onSignOut={() => void signOut()} />;
  if (status === "loading" || redirect) return <FullScreenLoader />;
  return <>{children}</>;
}

/** Étapes d'inscription qui exigent une session ouverte (téléphone, université…). */
export function RequireSession({
  children,
  fallback = "/inscription/pays",
}: {
  children: ReactNode;
  fallback?: string;
}) {
  const { status, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "anonymous") void navigate({ to: fallback as "/", replace: true });
  }, [status, navigate, fallback]);

  if (status === "unconfigured") return <ConfigMissingScreen />;
  if (status === "mfa_required") return <MfaChallengeScreen onSignOut={() => void signOut()} />;
  if (status !== "authenticated") return <FullScreenLoader />;
  return <>{children}</>;
}

/** Back-office : connexion + rôle du personnel. Les actions sensibles exigent en plus le MFA côté base. */
export function RequireBackOffice({ children }: { children: ReactNode }) {
  const { status, accountStatus, hasBackOffice, refreshAccount, signOut } = useAuth();
  const navigate = useNavigate();
  const denied = status === "authenticated" && accountStatus === "ready" && !hasBackOffice;

  useEffect(() => {
    if (status === "anonymous") void navigate({ to: "/connexion", replace: true });
    else if (denied) void navigate({ to: "/acces-refuse", replace: true });
  }, [status, denied, navigate]);

  if (status === "unconfigured") return <ConfigMissingScreen />;
  if (status === "mfa_required") return <MfaChallengeScreen onSignOut={() => void signOut()} />;
  if (status === "authenticated" && accountStatus === "error") {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-4">
        <ServerErrorScreen onRetry={() => void refreshAccount()} />
      </div>
    );
  }
  if (status !== "authenticated" || accountStatus !== "ready" || denied)
    return <FullScreenLoader />;
  return <>{children}</>;
}
