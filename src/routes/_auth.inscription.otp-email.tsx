import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { OtpStep, type OtpOutcome, type ResendOutcome } from "@/components/auth/OtpStep";
import { useAuth } from "@/lib/auth";
import { useOnboarding } from "@/lib/onboarding";

export const Route = createFileRoute("/_auth/inscription/otp-email")({
  head: () => ({ meta: [{ title: "Code de vérification e-mail — CampusMarket" }] }),
  component: EmailOtpPage,
});

function EmailOtpPage() {
  const navigate = useNavigate();
  const { status, verifyEmailCode, resendEmailCode } = useAuth();
  const { email } = useOnboarding();

  // Rechargement de page : l'e-mail saisi n'est plus en mémoire, on repart de l'écran de création.
  // Déjà connecté (retour arrière après la vérification) : l'e-mail est vérifié, on passe à la suite.
  useEffect(() => {
    if (status === "authenticated") void navigate({ to: "/inscription/telephone", replace: true });
    else if (status === "anonymous" && !email)
      void navigate({ to: "/inscription/email", replace: true });
  }, [status, email, navigate]);

  const onVerify = async (code: string): Promise<OtpOutcome> => {
    const result = await verifyEmailCode(email, code);
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
    const result = await resendEmailCode(email);
    if (result.ok) return "sent";
    if (result.kind === "rate_limited") return "rate_limited";
    return result.kind === "network" ? "network" : "error";
  };

  return (
    <OtpStep
      channel="email"
      target={email}
      step={2}
      back="/inscription/email"
      next="/inscription/telephone"
      title="Vérifiez votre e-mail"
      description="Saisissez le code à 6 chiffres reçu dans votre boîte de réception (pensez aux courriers indésirables)."
      onVerify={onVerify}
      onResend={onResend}
    />
  );
}
