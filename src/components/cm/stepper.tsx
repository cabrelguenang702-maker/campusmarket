import { cn } from "@/lib/utils";
import { Check } from "@/components/icons";

/** Indicateur d'étapes : libellés sur écran large, version compacte sur mobile. `current` commence à 1. */
export function Stepper({ steps, current, className }: { steps: readonly string[]; current: number; className?: string }) {
  return (
    <div className={className} role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={current} aria-label={`Étape ${current} sur ${steps.length}`}>
      <ol className="hidden items-center sm:flex">
        {steps.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          return (
            <li key={label} className={cn("flex items-center", i < steps.length - 1 && "flex-auto")}>
              <span className="flex items-center gap-2">
                <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold", done ? "bg-primary text-primary-foreground" : active ? "border-2 border-primary bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                  {done ? <Check className="size-4" /> : n}
                </span>
                <span className={cn("whitespace-nowrap text-sm font-semibold", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
              </span>
              {i < steps.length - 1 && <span className={cn("mx-3 h-0.5 min-w-4 flex-1 rounded", done ? "bg-primary" : "bg-border")} />}
            </li>
          );
        })}
      </ol>
      <div className="sm:hidden">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-bold text-primary">{steps[current - 1]}</span>
          <span className="font-semibold text-muted-foreground">Étape {current}/{steps.length}</span>
        </div>
        <div className="flex gap-1.5">{steps.map((s, i) => <span key={s} className={cn("h-1.5 flex-1 rounded-full", i < current ? "bg-primary" : "bg-muted")} />)}</div>
      </div>
    </div>
  );
}
