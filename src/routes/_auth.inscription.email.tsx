import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ArrowRight, Check, Mail, User } from "@/components/icons";
import { AuthPage, IconBadge } from "@/components/auth/AuthPage";
import { AppLink } from "@/components/cm/app-link";
import { InlineAlert, LoadingButtonLabel } from "@/components/cm/feedback";
import { Field, IconInput, PasswordField, PasswordStrength } from "@/components/cm/forms";
import { useAuth } from "@/lib/auth";
import { isStrongPassword, isValidEmail, passwordRuleResults } from "@/lib/auth-utils";
import { useOnboarding } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_auth/inscription/email")({
  head: () => ({ meta: [{ title: "Créez votre compte — CampusMarket" }] }),
  component: AccountPage,
});

type Problem =
  | "nom"
  | "email"
  | "mot-de-passe"
  | "deja-utilise"
  | "limite"
  | "reseau"
  | "ferme"
  | "autre"
  | null;

/**
 * Création du compte : nom, e-mail et mot de passe. Le compte existe dès cette étape (Supabase envoie
 * le code à 6 chiffres) ; le téléphone, vérifié ensuite, exige une session ouverte côté serveur.
 */
function AccountPage() {
  const navigate = useNavigate();
  const { status, account, signUp } = useAuth();
  const { email, setEmail } = useOnboarding();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [loading, setLoading] = useState(false);

  // Déjà connecté (retour arrière après le code, ou session ouverte sans confirmation d'e-mail) :
  // on reprend là où l'inscription s'est arrêtée au lieu de recréer un compte.
  useEffect(() => {
    if (status !== "authenticated" || !account) return;
    void navigate({
      to: account.profile.universityId ? "/" : "/inscription/telephone",
      replace: true,
    });
  }, [status, account, navigate]);

  const rules = passwordRuleResults(password);

  const submit = async () => {
    if (loading) return;
    if (fullName.trim().length < 2) return setProblem("nom");
    if (!isValidEmail(email)) return setProblem("email");
    if (!isStrongPassword(password)) return setProblem("mot-de-passe");
    setProblem(null);
    setLoading(true);
    const result = await signUp({ email, password, fullName });
    setLoading(false);

    if (result.ok) {
      void navigate({
        to: result.needsEmailCode ? "/inscription/otp-email" : "/inscription/telephone",
      });
      return;
    }
    switch (result.kind) {
      case "already_registered":
        return setProblem("deja-utilise");
      case "rate_limited":
        return setProblem("limite");
      case "weak_password":
        return setProblem("mot-de-passe");
      case "network":
        return setProblem("reseau");
      case "signup_disabled":
        return setProblem("ferme");
      default:
        return setProblem("autre");
    }
  };

  return (
    <AuthPage
      step={2}
      back="/inscription/pays"
      title="Créez votre compte"
      description="Votre adresse e-mail sécurise votre compte, permet de récupérer votre mot de passe et de recevoir vos reçus."
      icon={<IconBadge icon={Mail} />}
    >
      <div className="space-y-4">
        <Field
          label="Nom complet"
          htmlFor="full-name"
          error={problem === "nom" ? "Saisissez votre nom et prénom." : undefined}
        >
          <IconInput
            id="full-name"
            icon={User}
            autoComplete="name"
            placeholder="Jean Dupont"
            value={fullName}
            invalid={problem === "nom"}
            maxLength={100}
            onChange={(e) => {
              setFullName(e.target.value);
              if (problem === "nom") setProblem(null);
            }}
          />
        </Field>
        <Field
          label="Adresse e-mail"
          htmlFor="email"
          error={
            problem === "email"
              ? "Saisissez une adresse e-mail valide, par exemple nom@universite.cm."
              : undefined
          }
          hint="Une adresse universitaire facilite la vérification de votre compte."
        >
          <IconInput
            id="email"
            type="email"
            icon={Mail}
            autoComplete="email"
            placeholder="nom@exemple.com"
            value={email}
            invalid={problem === "email" || problem === "deja-utilise"}
            maxLength={254}
            onChange={(e) => {
              setEmail(e.target.value);
              if (problem === "email" || problem === "deja-utilise") setProblem(null);
            }}
          />
        </Field>
        <Field
          label="Mot de passe"
          htmlFor="password"
          error={
            problem === "mot-de-passe"
              ? "Ce mot de passe ne respecte pas toutes les règles ci-dessous."
              : undefined
          }
        >
          <PasswordField
            id="password"
            autoComplete="new-password"
            placeholder="Choisissez un mot de passe"
            value={password}
            invalid={problem === "mot-de-passe"}
            onChange={(e) => {
              setPassword(e.target.value);
              if (problem === "mot-de-passe") setProblem(null);
            }}
          />
        </Field>
        <PasswordStrength value={password} />
        <ul className="grid gap-1.5 text-xs">
          {rules.map(({ label, ok }) => (
            <li
              key={label}
              className={cn(
                "flex items-center gap-2",
                ok ? "text-success" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-4 place-items-center rounded-full",
                  ok ? "bg-success/15" : "bg-muted",
                )}
              >
                {ok && <Check className="size-3" />}
              </span>
              {label}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 space-y-3" aria-live="polite">
        {problem === "deja-utilise" && (
          <InlineAlert
            tone="warning"
            title="Cette adresse est déjà utilisée"
            action={
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <AppLink to="/connexion">Se connecter</AppLink>
              </Button>
            }
          >
            Un compte existe déjà avec cet e-mail. Connectez-vous ou utilisez une autre adresse.
          </InlineAlert>
        )}
        {problem === "limite" && (
          <InlineAlert tone="warning" title="Trop de tentatives">
            Trop de demandes en peu de temps. Patientez quelques minutes avant de réessayer.
          </InlineAlert>
        )}
        {problem === "reseau" && (
          <InlineAlert tone="danger" title="Connexion impossible">
            Le code n'a pas pu être envoyé. Vérifiez votre connexion puis réessayez.
          </InlineAlert>
        )}
        {problem === "ferme" && (
          <InlineAlert tone="danger" title="Inscriptions indisponibles">
            Les inscriptions sont momentanément fermées. Réessayez plus tard.
          </InlineAlert>
        )}
        {problem === "autre" && (
          <InlineAlert tone="danger" title="Création impossible">
            Le compte n'a pas pu être créé. Réessayez dans un instant.
          </InlineAlert>
        )}
      </div>

      <div className="mt-5 flex items-start gap-3">
        <Checkbox
          id="terms"
          checked={accepted}
          onCheckedChange={(v) => setAccepted(v === true)}
          className="mt-0.5"
        />
        <Label htmlFor="terms" className="text-xs font-normal leading-5 text-muted-foreground">
          J'accepte les{" "}
          <AppLink to="/aide" className="font-semibold text-primary hover:underline">
            conditions d'utilisation
          </AppLink>{" "}
          et la{" "}
          <AppLink to="/aide" className="font-semibold text-primary hover:underline">
            politique de confidentialité
          </AppLink>{" "}
          de CampusMarket.
        </Label>
      </div>
      <Button
        size="lg"
        className="mt-6 w-full"
        disabled={!accepted || loading}
        onClick={() => void submit()}
      >
        <LoadingButtonLabel loading={loading} loadingText="Création du compte…">
          Recevoir le code <ArrowRight />
        </LoadingButtonLabel>
      </Button>
    </AuthPage>
  );
}
