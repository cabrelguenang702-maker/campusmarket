import { createFileRoute } from "@tanstack/react-router";
import { OtpStep, type OtpOutcome, type ResendOutcome } from "@/components/auth/OtpStep";
import { invokeFunction } from "@/lib/api/functions";
import { RequireSession, useAuth } from "@/lib/auth";
import { formatCameroonPhone, toE164 } from "@/lib/auth-utils";
import { useOnboarding } from "@/lib/onboarding";

export const Route = createFileRoute("/_auth/inscription/otp-telephone")({
  head: () => ({ meta: [{ title: "Code de vérification SMS — CampusMarket" }] }),
  component: () => (
    <RequireSession>
      <PhoneOtpPage />
    </RequireSession>
  ),
});

function PhoneOtpPage() {
  const { country, phone } = useOnboarding();
  const { refreshAccount } = useAuth();
  const e164 = toE164(country.dial, phone) ?? "";

  const onVerify = async (code: string): Promise<OtpOutcome> => {
    const result = await invokeFunction("phone-otp-verify", { phone_number: e164, code });
    if (result.ok) {
      await refreshAccount();
      return { outcome: "ok" };
    }
    if (result.kind !== "http") return { outcome: "network" };
    switch (result.code) {
      case "invalid_code": {
        const left = result.body["attempts_remaining"];
        return typeof left === "number"
          ? { outcome: "incorrect", attemptsRemaining: left }
          : { outcome: "incorrect" };
      }
      case "invalid_code_format":
        return { outcome: "incorrect" };
      case "code_expired":
      case "no_active_code":
        return { outcome: "expired" };
      case "too_many_attempts":
        return { outcome: "too_many" };
      case "phone_already_used":
        return { outcome: "conflict" };
      default:
        return { outcome: "error" };
    }
  };

  const onResend = async (): Promise<ResendOutcome> => {
    const result = await invokeFunction("phone-otp-request", { phone_number: e164 });
    if (result.ok) return "sent";
    if (result.kind === "http") return result.status === 429 ? "rate_limited" : "error";
    return "network";
  };

  return (
    <OtpStep
      channel="phone"
      target={formatCameroonPhone(e164)}
      step={3}
      back="/inscription/telephone"
      next="/inscription/universite"
      title="Entrez le code reçu par SMS"
      description="Saisissez le code à 6 chiffres envoyé à votre numéro."
      onVerify={onVerify}
      onResend={onResend}
    />
  );
}
