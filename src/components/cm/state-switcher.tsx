import { cn } from "@/lib/utils";
import { DESIGN_REVIEW_MODE } from "@/lib/config";
import { Sliders } from "@/components/icons";

/**
 * Barre « Aperçu des états » : permet de passer d'un état d'écran à l'autre
 * (chargement, vide, erreur, succès…) pour valider le design. Désactivable via DESIGN_REVIEW_MODE.
 */
export function StateSwitcher<T extends string>({ states, value, onChange, className }: {
  states: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  if (!DESIGN_REVIEW_MODE) return null;
  return (
    <div className={cn("mb-5 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-2.5", className)} role="group" aria-label="Aperçu des états de l'écran">
      <p className="mb-2 flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-primary"><Sliders className="size-3.5" /> Maquette · états de l'écran</p>
      <div className="no-scrollbar -mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pb-0.5">
        {states.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={value === s.id}
            onClick={() => onChange(s.id)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              value === s.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
