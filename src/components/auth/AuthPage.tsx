import type { ReactNode } from "react";
import type { IconType } from "@/components/icons";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { SIGNUP_STEP_COUNT } from "@/lib/config";

export const SIGNUP_STEPS = SIGNUP_STEP_COUNT;

/** Progression segmentée de l'inscription (Pays → Compte → Téléphone → Université, + Paiement si activé). */
export function StepProgress({ step, total = SIGNUP_STEPS }: { step: number; total?: number }) {
  return (
    <div className="flex items-center gap-3" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step} aria-label={`Étape ${step} sur ${total}`}>
      <div className="flex flex-1 gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i < step ? "bg-primary" : "bg-muted")} />
        ))}
      </div>
      <span className="text-xs font-semibold text-muted-foreground">Étape {step}/{total}</span>
    </div>
  );
}

type Props = {
  title: string;
  description?: string | undefined;
  step?: number | undefined;
  back?: string | undefined;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string | undefined;
};

/** Gabarit d'un écran d'authentification : retour, progression, titre, contenu, pied de page. */
export function AuthPage({ title, description, step, back, icon, children, footer, className }: Props) {
  return (
    <div className={cn("fade-up flex flex-1 flex-col", className)}>
      {(back || step) && (
        <div className="mb-6 space-y-4">
          {back && (
            <AppLink to={back} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-[18px]" /> Retour</AppLink>
          )}
          {step && <StepProgress step={step} />}
        </div>
      )}
      {icon && <div className="mb-5">{icon}</div>}
      <h1 className="font-display text-2xl font-bold leading-tight sm:text-[1.7rem]">{title}</h1>
      {description && <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>}
      <div className="mt-6 flex-1">{children}</div>
      {footer && <div className="mt-8 text-center text-sm text-muted-foreground">{footer}</div>}
    </div>
  );
}

export function IconBadge({ icon: Icon, tone = "primary", className }: { icon: IconType; tone?: "primary" | "success" | "danger" | "warning"; className?: string }) {
  const tones = { primary: "bg-primary/12 text-primary", success: "bg-success/15 text-success", danger: "bg-destructive/12 text-destructive", warning: "bg-warning/20 text-[oklch(0.42_0.1_65)] dark:text-warning" };
  return <span className={cn("grid size-14 place-items-center rounded-2xl", tones[tone], className)}><Icon className="size-7" /></span>;
}
