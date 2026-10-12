import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ArrowRight, User } from "@/components/icons";
import { AuthPage } from "@/components/auth/AuthPage";
import { AppLink } from "@/components/cm/app-link";
import { InlineAlert, LoadingButtonLabel } from "@/components/cm/feedback";
import { Field, IconInput, PasswordField } from "@/components/cm/forms";
import { SESSION_EXPIRED_KEY, useAuth } from "@/lib/auth";
import { looksLikeEmail } from "@/lib/auth-utils";
import { useOnboarding } from "@/lib/onboarding";

export const Route = createFileRoute("/_auth/connexion")({
  head: () => ({ meta: [{ title: "Connexion — CampusMarket" }] }),
  component: LoginPage,
});

type Problem = "identifiants" | "telephone" | "non-confirme" | "limite" | "reseau" | "autre" | null;

function LoginPage() {
  const navigate = useNavigate();
  const { signIn, resendEmailCode } = useAuth();
  const { setEmail } = useOnboarding();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [problem, setProblem] = useState<Problem>(null);
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(false);

  // Message « session expirée » : posé par le fournisseur quand la session est perdue sans déconnexion voulue.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(SESSION_EXPIRED_KEY)) {
        setExpired(true);
        window.sessionStorage.removeItem(SESSION_EXPIRED_KEY);
      }
    } catch {
      /* sans conséquence */
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const id = identifier.trim();
    if (!looksLikeEmail(id)) {
      // La connexion par numéro exige une recherche côté serveur (jamais exposée au navigateur : elle révélerait
      // l'e-mail associé à un numéro) ; elle n'existe pas encore.
      return setProblem("telephone");
    }
    setProblem(null);
    setExpired(false);
    setLoading(true);
    const result = await signIn(id, password, remember);

    if (result.ok) return; // RequireGuest redirige vers l'accueil (ou la page d'origine) dès que la session s'ouvre.

    if (result.kind === "email_not_confirmed") {
      // Inscription jamais terminée : on renvoie un code et on reprend à l'étape de vérification.
      setEmail(id);
      await resendEmailCode(id);
      setLoading(false);
      return void navigate({ to: "/inscription/otp-email" });
    }
    setLoading(false);
    switch (result.kind) {
      case "invalid_credentials":
        return setProblem("identifiants");
      case "rate_limited":
        return setProblem("limite");
      case "network":
        return setProblem("reseau");
      default:
        return setProblem("autre");
    }
  };

  const invalid = problem === "identifiants";

  return (
    <AuthPage
      title="Bon retour parmi nous"
      description="Connectez-vous pour retrouver vos annonces, vos messages et votre campus."
      footer={
        <>
          Pas encore de compte ?{" "}
          <AppLink to="/inscription/pays" className="font-semibold text-primary hover:underline">
            Créer un compte
          </AppLink>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        {expired && (
          <InlineAlert tone="warning" title="Votre session a expiré">
            Pour votre sécurité, veuillez vous reconnecter pour continuer.
          </InlineAlert>
        )}
        {problem === "identifiants" && (
          <InlineAlert tone="danger" title="Identifiants incorrects">
            L'e-mail ou le mot de passe est erroné. Après plusieurs essais, la connexion est
            temporairement bloquée.
          </InlineAlert>
        )}
        {problem === "telephone" && (
          <InlineAlert tone="warning" title="Connexion par numéro indisponible">
            Pour le moment, connectez-vous avec l'adresse e-mail de votre compte.
          </InlineAlert>
        )}
        {problem === "limite" && (
          <InlineAlert tone="warning" title="Trop de tentatives">
            Patientez quelques minutes avant de réessayer.
          </InlineAlert>
        )}
        {problem === "reseau" && (
          <InlineAlert tone="danger" title="Connexion impossible">
            Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.
          </InlineAlert>
        )}
        {problem === "autre" && (
          <InlineAlert tone="danger" title="Connexion impossible">
            Une erreur est survenue. Réessayez dans un instant.
          </InlineAlert>
        )}
        <Field label="Adresse e-mail" htmlFor="identifier">
          <IconInput
            id="identifier"
            icon={User}
            type="email"
            autoComplete="username"
            placeholder="nom@exemple.com"
            value={identifier}
            invalid={invalid || problem === "telephone"}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </Field>
        <Field label="Mot de passe" htmlFor="password">
          <PasswordField
            id="password"
            autoComplete="current-password"
            placeholder="Votre mot de passe"
            value={password}
            invalid={invalid}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="remember"
              checked={remember}
              onCheckedChange={(v) => setRemember(v === true)}
            />
            <Label htmlFor="remember" className="text-sm font-normal text-muted-foreground">
              Rester connecté
            </Label>
          </div>
          <AppLink
            to="/mot-de-passe-oublie"
            className="text-sm font-semibold text-primary hover:underline"
          >
            Mot de passe oublié ?
          </AppLink>
        </div>
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={loading || !identifier || !password}
        >
          <LoadingButtonLabel loading={loading} loadingText="Connexion…">
            Se connecter <ArrowRight />
          </LoadingButtonLabel>
        </Button>
      </form>
    </AuthPage>
  );
}
