import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, Check, CheckCircle, Lock } from "@/components/icons";
import { AuthPage, IconBadge } from "@/components/auth/AuthPage";
import { AppLink } from "@/components/cm/app-link";
import { InlineAlert, LoadingButtonLabel, StateScreen } from "@/components/cm/feedback";
import { Field, PasswordField, PasswordStrength } from "@/components/cm/forms";
import { useAuth } from "@/lib/auth";
import { isStrongPassword, passwordRuleResults } from "@/lib/auth-utils";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_auth/reinitialisation/nouveau-mot-de-passe")({
  head: () => ({ meta: [{ title: "Nouveau mot de passe — CampusMarket" }] }),
  component: NewPasswordPage,
});

type Problem = "differents" | "faible" | "identique" | "limite" | "reseau" | "autre" | null;

function NewPasswordPage() {
  const navigate = useNavigate();
  const { status, updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<Problem>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  // Après l'enregistrement, toutes les sessions sont fermées : la session de récupération disparaît
  // et ce n'est PAS une raison de renvoyer l'utilisateur au début du parcours.
  const finished = useRef(false);

  // Cet écran n'a de sens qu'avec la session de récupération ouverte par le code (sinon : retour à la demande).
  useEffect(() => {
    if (status === "anonymous" && !finished.current)
      void navigate({ to: "/mot-de-passe-oublie", replace: true });
  }, [status, navigate]);

  const rules = passwordRuleResults(password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!isStrongPassword(password)) return setProblem("faible");
    if (password !== confirm) return setProblem("differents");
    setProblem(null);
    setLoading(true);
    finished.current = true; // posé AVANT l'appel : la fermeture des sessions survient pendant l'appel
    const result = await updatePassword(password);
    setLoading(false);

    if (result.ok) return setDone(true);
    finished.current = false;
    switch (result.kind) {
      case "weak_password":
        return setProblem("faible");
      case "same_password":
        return setProblem("identique");
      case "rate_limited":
        return setProblem("limite");
      case "network":
        return setProblem("reseau");
      default:
        return setProblem("autre");
    }
  };

  if (done) {
    return (
      <AuthPage title="Mot de passe modifié">
        <StateScreen
          icon={CheckCircle}
          tone="success"
          title="Réinitialisation réussie"
          description="Votre mot de passe a bien été mis à jour et vos autres appareils ont été déconnectés. Vous pouvez maintenant vous connecter avec votre nouveau mot de passe."
          actions={
            <Button asChild size="lg" className="w-full">
              <AppLink to="/connexion">
                Se connecter <ArrowRight />
              </AppLink>
            </Button>
          }
        />
      </AuthPage>
    );
  }

  return (
    <AuthPage
      title="Choisissez un nouveau mot de passe"
      description="Utilisez un mot de passe que vous n'avez encore jamais utilisé sur CampusMarket."
      icon={<IconBadge icon={Lock} />}
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <Field
          label="Nouveau mot de passe"
          htmlFor="new-password"
          error={
            problem === "faible"
              ? "Ce mot de passe ne respecte pas toutes les règles ci-dessous."
              : problem === "identique"
                ? "Choisissez un mot de passe différent de l'ancien."
                : undefined
          }
        >
          <PasswordField
            id="new-password"
            autoComplete="new-password"
            placeholder="Nouveau mot de passe"
            value={password}
            invalid={problem === "faible" || problem === "identique"}
            onChange={(e) => {
              setPassword(e.target.value);
              setProblem(null);
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
        <Field
          label="Confirmer le mot de passe"
          htmlFor="confirm-password"
          error={
            problem === "differents" ? "Les deux mots de passe ne sont pas identiques." : undefined
          }
        >
          <PasswordField
            id="confirm-password"
            autoComplete="new-password"
            placeholder="Répétez le mot de passe"
            value={confirm}
            invalid={problem === "differents"}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (problem === "differents") setProblem(null);
            }}
          />
        </Field>
        {problem === "limite" && (
          <InlineAlert tone="warning" title="Trop de tentatives">
            Patientez quelques minutes avant de réessayer.
          </InlineAlert>
        )}
        {problem === "reseau" && (
          <InlineAlert tone="danger" title="Connexion impossible">
            Le mot de passe n'a pas pu être enregistré. Vérifiez votre connexion puis réessayez.
          </InlineAlert>
        )}
        {problem === "autre" && (
          <InlineAlert
            tone="danger"
            title="Enregistrement impossible"
            action={
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <AppLink to="/mot-de-passe-oublie">Recommencer</AppLink>
              </Button>
            }
          >
            Le mot de passe n'a pas pu être enregistré. Le code a peut-être expiré : recommencez la
            procédure.
          </InlineAlert>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          <LoadingButtonLabel loading={loading} loadingText="Enregistrement…">
            Enregistrer le mot de passe
          </LoadingButtonLabel>
        </Button>
      </form>
    </AuthPage>
  );
}
