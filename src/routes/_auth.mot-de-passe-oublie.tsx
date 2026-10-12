import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, Key, User } from "@/components/icons";
import { AuthPage, IconBadge } from "@/components/auth/AuthPage";
import { InlineAlert, LoadingButtonLabel } from "@/components/cm/feedback";
import { Field, IconInput } from "@/components/cm/forms";
import { useAuth } from "@/lib/auth";
import { isValidEmail, looksLikeEmail } from "@/lib/auth-utils";
import { useOnboarding } from "@/lib/onboarding";

export const Route = createFileRoute("/_auth/mot-de-passe-oublie")({
  head: () => ({ meta: [{ title: "Mot de passe oublié — CampusMarket" }] }),
  component: ForgotPasswordPage,
});

type Problem = "invalide" | "telephone" | "limite" | "reseau" | "autre" | null;

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { requestPasswordReset } = useAuth();
  const { resetTarget, setResetTarget } = useOnboarding();
  const [problem, setProblem] = useState<Problem>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const id = resetTarget.trim();
    if (!looksLikeEmail(id)) return setProblem(id ? "telephone" : "invalide");
    if (!isValidEmail(id)) return setProblem("invalide");
    setProblem(null);
    setLoading(true);
    const result = await requestPasswordReset(id);
    setLoading(false);

    // Volontairement AUCUN écran « compte introuvable » : répondre différemment selon que l'adresse existe
    // permettrait de lister les comptes. Supabase répond pareil dans les deux cas ; l'écran suivant le dit.
    if (result.ok) return void navigate({ to: "/reinitialisation/code" });
    switch (result.kind) {
      case "rate_limited":
        return setProblem("limite");
      case "network":
        return setProblem("reseau");
      default:
        return setProblem("autre");
    }
  };

  return (
    <AuthPage
      back="/connexion"
      title="Mot de passe oublié ?"
      description="Saisissez l'adresse e-mail de votre compte. Si elle est connue, nous vous envoyons un code pour choisir un nouveau mot de passe."
      icon={<IconBadge icon={Key} />}
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <Field
          label="Adresse e-mail"
          htmlFor="reset-id"
          error={problem === "invalide" ? "Saisissez une adresse e-mail valide." : undefined}
        >
          <IconInput
            id="reset-id"
            icon={User}
            type="email"
            autoComplete="username"
            placeholder="nom@exemple.com"
            value={resetTarget}
            invalid={problem === "invalide" || problem === "telephone"}
            onChange={(e) => {
              setResetTarget(e.target.value);
              setProblem(null);
            }}
          />
        </Field>
        {problem === "telephone" && (
          <InlineAlert tone="warning" title="Récupération par SMS indisponible">
            Pour le moment, la récupération se fait avec l'adresse e-mail de votre compte.
          </InlineAlert>
        )}
        {problem === "limite" && (
          <InlineAlert tone="warning" title="Trop de demandes">
            Patientez quelques minutes avant de redemander un code.
          </InlineAlert>
        )}
        {problem === "reseau" && (
          <InlineAlert tone="danger" title="Connexion impossible">
            Le code n'a pas pu être envoyé. Réessayez dans un instant.
          </InlineAlert>
        )}
        {problem === "autre" && (
          <InlineAlert tone="danger" title="Envoi impossible">
            Le code n'a pas pu être envoyé. Réessayez dans un instant.
          </InlineAlert>
        )}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={loading || !resetTarget.trim()}
        >
          <LoadingButtonLabel loading={loading} loadingText="Envoi du code…">
            Envoyer le code <ArrowRight />
          </LoadingButtonLabel>
        </Button>
      </form>
    </AuthPage>
  );
}
