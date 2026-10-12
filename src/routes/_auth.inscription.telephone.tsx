import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, Smartphone } from "@/components/icons";
import { AuthPage, IconBadge } from "@/components/auth/AuthPage";
import { InlineAlert, LoadingButtonLabel } from "@/components/cm/feedback";
import { Field, PhoneField } from "@/components/cm/forms";
import { invokeFunction } from "@/lib/api/functions";
import { RequireSession } from "@/lib/auth";
import { isCameroonMobile, toE164 } from "@/lib/auth-utils";
import { PHONE_VERIFICATION_REQUIRED, SMS_SUPPORTED_COUNTRIES } from "@/lib/config";
import { useOnboarding } from "@/lib/onboarding";

export const Route = createFileRoute("/_auth/inscription/telephone")({
  head: () => ({ meta: [{ title: "Votre numéro de téléphone — CampusMarket" }] }),
  component: () => (
    <RequireSession>
      <PhonePage />
    </RequireSession>
  ),
});

type Problem = "invalide" | "limite" | "sms" | "session" | "reseau" | null;

function PhonePage() {
  const navigate = useNavigate();
  const { country, phone, setPhone } = useOnboarding();
  const [problem, setProblem] = useState<Problem>(null);
  const [loading, setLoading] = useState(false);
  const smsSupported = SMS_SUPPORTED_COUNTRIES.includes(country.code);

  const skip = () => void navigate({ to: "/inscription/universite" });

  const submit = async () => {
    if (loading) return;
    const e164 = toE164(country.dial, phone);
    if (!e164 || !isCameroonMobile(e164)) return setProblem("invalide");
    setProblem(null);
    setLoading(true);
    const result = await invokeFunction("phone-otp-request", { phone_number: e164 });
    setLoading(false);

    if (result.ok) return void navigate({ to: "/inscription/otp-telephone" });
    if (result.kind === "http") {
      if (result.status === 400) return setProblem("invalide");
      if (result.status === 429) return setProblem("limite");
      if (result.status === 401) return setProblem("session");
      if (result.status === 502) return setProblem("sms");
    }
    setProblem("reseau");
  };

  return (
    <AuthPage
      step={3}
      title="Quel est votre numéro ?"
      description="Nous vous envoyons un code par SMS pour vérifier votre numéro. Il servira aussi à vos paiements Mobile Money."
      icon={<IconBadge icon={Smartphone} />}
    >
      {smsSupported ? (
        <Field
          label="Numéro de téléphone"
          htmlFor="phone"
          error={
            problem === "invalide"
              ? "Saisissez un numéro valide (9 chiffres pour le Cameroun)."
              : undefined
          }
          hint={`Format ${country.dial} suivi de votre numéro, sans le 0.`}
        >
          <PhoneField
            id="phone"
            country={country}
            value={phone}
            onChange={(v) => {
              setPhone(v);
              if (problem === "invalide") setProblem(null);
            }}
            invalid={problem === "invalide"}
          />
        </Field>
      ) : (
        <InlineAlert tone="info" title="Vérification par SMS bientôt disponible">
          La vérification du téléphone n'est pas encore disponible pour {country.name}. Vous pourrez
          la faire plus tard depuis votre profil.
        </InlineAlert>
      )}

      <div className="mt-4 space-y-3" aria-live="polite">
        {problem === "limite" && (
          <InlineAlert tone="warning" title="Trop de demandes">
            Vous avez demandé plusieurs codes pour ce numéro. Patientez environ une heure avant de
            réessayer.
          </InlineAlert>
        )}
        {problem === "sms" && (
          <InlineAlert tone="warning" title="Envoi du SMS impossible">
            Le service SMS est momentanément indisponible. Vous pouvez passer cette étape et
            vérifier votre numéro plus tard.
          </InlineAlert>
        )}
        {problem === "session" && (
          <InlineAlert tone="danger" title="Session expirée">
            Votre session a expiré. Reprenez l'inscription depuis le début ou connectez-vous.
          </InlineAlert>
        )}
        {problem === "reseau" && (
          <InlineAlert tone="danger" title="Connexion impossible">
            Le code n'a pas pu être envoyé. Vérifiez votre connexion puis réessayez.
          </InlineAlert>
        )}
      </div>

      {smsSupported && (
        <Button size="lg" className="mt-6 w-full" disabled={loading} onClick={() => void submit()}>
          <LoadingButtonLabel loading={loading} loadingText="Envoi du code…">
            Recevoir le code <ArrowRight />
          </LoadingButtonLabel>
        </Button>
      )}
      {(!PHONE_VERIFICATION_REQUIRED || !smsSupported) && (
        <Button
          variant={smsSupported ? "ghost" : "default"}
          size="lg"
          className="mt-3 w-full"
          onClick={skip}
        >
          {smsSupported ? (
            "Passer cette étape"
          ) : (
            <>
              Continuer <ArrowRight />
            </>
          )}
        </Button>
      )}
    </AuthPage>
  );
}
