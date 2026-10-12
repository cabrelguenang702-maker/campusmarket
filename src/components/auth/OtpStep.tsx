import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Mail, Smartphone, RefreshCw } from "@/components/icons";
import { InlineAlert, LoadingButtonLabel } from "@/components/cm/feedback";
import { OtpField } from "@/components/cm/forms";
import { AuthPage, IconBadge } from "./AuthPage";

export type OtpState =
  | "normal"
  | "incorrect"
  | "expire"
  | "trop"
  | "renvoye"
  | "verification"
  | "reseau"
  | "limite"
  | "conflit";

/** Résultat d'une vérification de code, tel que les écrans le traduisent depuis Supabase ou les Edge Functions. */
export type OtpOutcome =
  | { outcome: "ok" }
  | { outcome: "incorrect"; attemptsRemaining?: number }
  | { outcome: "expired" }
  | { outcome: "too_many" }
  | { outcome: "conflict" }
  | { outcome: "network" }
  | { outcome: "error" };

export type ResendOutcome = "sent" | "rate_limited" | "network" | "error";

const RESEND_DELAY = 45;

/**
 * Écran de saisie d'un code à 6 chiffres (e-mail, téléphone ou réinitialisation). La vérification et le
 * renvoi sont fournis par l'écran appelant : ce composant ne connaît ni Supabase ni les Edge Functions.
 */
export function OtpStep({
  channel,
  target,
  step,
  back,
  next,
  title,
  description,
  onVerify,
  onResend,
}: {
  channel: "phone" | "email";
  target: string;
  step?: number | undefined;
  back: string;
  next: string;
  title: string;
  description: string;
  onVerify: (code: string) => Promise<OtpOutcome>;
  onResend: () => Promise<ResendOutcome>;
}) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [state, setState] = useState<OtpState>("normal");
  const [attempts, setAttempts] = useState<number | undefined>(undefined);
  const [seconds, setSeconds] = useState(RESEND_DELAY);
  // Un code complet déclenche la vérification automatiquement ; ce verrou empêche le double envoi
  // (saisie du dernier chiffre puis clic sur « Vérifier » avant la réponse).
  const inFlight = useRef(false);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const verify = async (value: string) => {
    if (inFlight.current || value.length < 6) return;
    inFlight.current = true;
    setState("verification");
    try {
      const result = await onVerify(value);
      switch (result.outcome) {
        case "ok":
          toast.success(channel === "phone" ? "Numéro vérifié" : "Adresse e-mail vérifiée");
          void navigate({ to: next as "/" });
          return;
        case "incorrect":
          setAttempts(result.attemptsRemaining);
          setState("incorrect");
          return;
        case "expired":
          setState("expire");
          return;
        case "too_many":
          setState("trop");
          return;
        case "conflict":
          setState("conflit");
          return;
        case "network":
          setState("reseau");
          return;
        default:
          setState("reseau");
      }
    } finally {
      inFlight.current = false;
    }
  };

  const resend = async () => {
    setCode("");
    setState("normal");
    const result = await onResend();
    if (result === "sent") {
      setState("renvoye");
      setSeconds(RESEND_DELAY);
      toast.info("Un nouveau code vient d'être envoyé");
    } else if (result === "rate_limited") {
      setState("limite");
      setSeconds(RESEND_DELAY);
    } else {
      setState("reseau");
    }
  };

  const busy = state === "verification";
  const blocked = state === "expire" || state === "trop" || state === "conflit";
  const invalid = state === "incorrect" || blocked;
  const Icon = channel === "phone" ? Smartphone : Mail;

  return (
    <AuthPage
      step={step}
      back={back}
      title={title}
      description={description}
      icon={<IconBadge icon={Icon} />}
    >
      <p className="mb-4 text-sm">
        Code envoyé à <span className="font-semibold">{target}</span>
      </p>
      <OtpField
        value={code}
        onChange={(v) => {
          setCode(v);
          if (state === "incorrect" || state === "reseau" || state === "limite") setState("normal");
        }}
        onComplete={(v) => void verify(v)}
        invalid={invalid}
        disabled={busy || blocked}
      />

      <div className="mt-4 min-h-14 space-y-2" aria-live="polite">
        {state === "incorrect" && (
          <InlineAlert tone="danger" title="Code incorrect ou expiré">
            Vérifiez les 6 chiffres reçus et réessayez, ou demandez un nouveau code.
            {attempts !== undefined && attempts > 0 && (
              <>
                {" "}
                Il vous reste {attempts} tentative{attempts > 1 ? "s" : ""}.
              </>
            )}
          </InlineAlert>
        )}
        {state === "expire" && (
          <InlineAlert tone="warning" title="Ce code a expiré">
            Pour votre sécurité, un code n'est valable que pendant un temps limité. Demandez-en un
            nouveau.
          </InlineAlert>
        )}
        {state === "trop" && (
          <InlineAlert tone="danger" title="Trop de tentatives">
            Ce code est désactivé. Demandez-en un nouveau pour réessayer.
          </InlineAlert>
        )}
        {state === "conflit" && (
          <InlineAlert tone="danger" title="Numéro déjà utilisé">
            Ce numéro est déjà vérifié sur un autre compte. Utilisez un autre numéro ou contactez le
            support.
          </InlineAlert>
        )}
        {state === "renvoye" && (
          <InlineAlert tone="success" title="Nouveau code envoyé">
            Le précédent code n'est plus valable. Saisissez le plus récent.
          </InlineAlert>
        )}
        {state === "limite" && (
          <InlineAlert tone="warning" title="Trop de demandes">
            Vous avez demandé beaucoup de codes. Patientez quelques minutes avant d'en redemander
            un.
          </InlineAlert>
        )}
        {state === "reseau" && (
          <InlineAlert tone="danger" title="Connexion impossible">
            Impossible de joindre le serveur. Vérifiez votre connexion puis réessayez.
          </InlineAlert>
        )}
      </div>

      <Button
        size="lg"
        className="mt-4 w-full"
        disabled={code.length < 6 || busy || blocked}
        onClick={() => void verify(code)}
      >
        <LoadingButtonLabel loading={busy} loadingText="Vérification…">
          Vérifier le code
        </LoadingButtonLabel>
      </Button>

      <div className="mt-5 text-center text-sm text-muted-foreground">
        {seconds > 0 && !blocked ? (
          <>
            Vous pouvez demander un nouveau code dans{" "}
            <span className="font-semibold tabular-nums text-foreground">
              0:{String(seconds).padStart(2, "0")}
            </span>
          </>
        ) : (
          <button
            className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
            onClick={() => void resend()}
          >
            <RefreshCw className="size-4" /> Renvoyer le code
          </button>
        )}
      </div>
    </AuthPage>
  );
}
