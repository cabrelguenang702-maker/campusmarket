import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertCircle, AlertTriangle, CheckCircle, InfoCircle, type IconType } from "@/components/icons";
import { toneSolidIcon, toneStyles, type Tone } from "./badges";

export function Spinner({ className, label = "Chargement" }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cn("inline-block size-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary", className)} />
  );
}

/**
 * Écran d'état plein cadre : vide, erreur, hors connexion, 404, accès refusé, session expirée…
 * `compact` = version encart (dans une liste ou une carte).
 */
export function StateScreen({ icon: Icon, tone = "neutral", title, description, actions, compact = false, className }: {
  icon: IconType;
  tone?: Tone;
  title: string;
  description?: string | undefined;
  actions?: ReactNode;
  compact?: boolean;
  className?: string | undefined;
}) {
  return (
    <div className={cn("fade-up mx-auto flex w-full max-w-md flex-col items-center text-center", compact ? "px-4 py-10" : "px-4 py-16", className)}>
      <span className={cn("mb-5 grid place-items-center rounded-2xl", toneSolidIcon[tone], compact ? "size-14" : "size-20")}>
        <Icon className={compact ? "size-7" : "size-10"} />
      </span>
      <h2 className={cn("font-display font-bold", compact ? "text-lg" : "text-2xl")}>{title}</h2>
      {description && <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>}
      {actions && <div className="mt-6 flex w-full flex-col justify-center gap-2 sm:w-auto sm:flex-row">{actions}</div>}
    </div>
  );
}

const alertIcons: Record<Tone, IconType> = {
  neutral: InfoCircle, primary: InfoCircle, info: InfoCircle, success: CheckCircle, warning: AlertTriangle, danger: AlertCircle,
};

export function InlineAlert({ tone = "info", title, children, action, className }: { tone?: Tone; title?: string | undefined; children?: ReactNode; action?: ReactNode; className?: string | undefined }) {
  const Icon = alertIcons[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border p-3.5 text-sm", toneStyles[tone], className)}>
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn("text-[13px] leading-5", title ? "mt-0.5 opacity-90" : "")}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirmer", cancelLabel = "Annuler", destructive = false, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm?: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <span className={cn("mx-auto mb-1 grid size-12 place-items-center rounded-xl sm:mx-0", destructive ? toneSolidIcon.danger : toneSolidIcon.primary)}>
            {destructive ? <AlertTriangle className="size-6" /> : <InfoCircle className="size-6" />}
          </span>
          <AlertDialogTitle className="font-display">{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel className="mt-0">{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className={cn(destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function LoadingButtonLabel({ loading, children, loadingText }: { loading: boolean; children: ReactNode; loadingText?: string }) {
  return loading ? (<><Spinner className="size-4 border-primary-foreground/30 border-t-primary-foreground" label={loadingText ?? "Chargement"} />{loadingText ?? "Chargement…"}</>) : <>{children}</>;
}

export { Button };
