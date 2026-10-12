import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { OtpStep, type OtpOutcome, type ResendOutcome } from "@/components/auth/OtpStep";
import { useAuth } from "@/lib/auth";
import { useOnboarding } from "@/lib/onboarding";

export const Route = createFileRoute("/_auth/reinitialisation/code")({
  head: () => ({ meta: [{ title: "Code de réinitialisation — CampusMarket" }] }),
  component: ResetCodePage,
});

function ResetCodePage() {
  const navigate = useNavigate();
  const { verifyRecoveryCode, requestPasswordReset } = useAuth();
  const { resetTarget } = useOnboarding();

  // Rechargement de page : l'adresse n'est plus en mémoire, on repart de la demande.
  useEffect(() => {
    if (!resetTarget) void navigate({ to: "/mot-de-passe-oublie", replace: true });
  }, [resetTarget, navigate]);

  const onVerify = async (code: string): Promise<OtpOutcome> => {
    const result = await verifyRecoveryCode(resetTarget, code);
    if (result.ok) return { outcome: "ok" };
    switch (result.kind) {
      case "code_invalid_or_expired":
        return { outcome: "incorrect" };
      case "rate_limited":
        return { outcome: "too_many" };
      case "network":
        return { outcome: "network" };
      default:
        return { outcome: "error" };
    }
  };

  const onResend = async (): Promise<ResendOutcome> => {
    const result = await requestPasswordReset(resetTarget);
    if (result.ok) return "sent";
    if (result.kind === "rate_limited") return "rate_limited";
    return result.kind === "network" ? "network" : "error";
  };

  return (
    <OtpStep
      channel="email"
      target={resetTarget}
      back="/mot-de-passe-oublie"
      next="/reinitialisation/nouveau-mot-de-passe"
      title="Entrez le code de réinitialisation"
      description="Saisissez le code à 6 chiffres reçu par e-mail. Si vous ne le recevez pas, vérifiez l'adresse saisie et vos courriers indésirables."
      onVerify={onVerify}
      onResend={onResend}
    />
  );
}
