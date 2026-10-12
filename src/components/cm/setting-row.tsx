import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { IconType } from "@/components/icons";

/** Ligne de réglage : libellé, aide et interrupteur (ou action personnalisée à droite). */
export function SettingRow({ id, label, description, icon: Icon, checked, onCheckedChange, action, disabled, className }: {
  id: string;
  label: string;
  description?: string | undefined;
  icon?: IconType | undefined;
  checked?: boolean | undefined;
  onCheckedChange?: ((v: boolean) => void) | undefined;
  action?: ReactNode;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex items-center gap-3 py-3.5", className)}>
      {Icon && <span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent text-primary"><Icon className="size-5" /></span>}
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-sm font-semibold">{label}</Label>
        {description && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>
      {action ?? <Switch id={id} checked={checked ?? false} disabled={disabled ?? false} onCheckedChange={(v) => onCheckedChange?.(v)} />}
    </div>
  );
}

/** Carte de section (titre + contenu) utilisée dans les paramètres. */
export function SettingsCard({ title, description, children, className }: { title?: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-4 sm:p-5", className)}>
      {title && <h2 className="font-display text-base font-bold">{title}</h2>}
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className={cn(title && "mt-3")}>{children}</div>
    </section>
  );
}
