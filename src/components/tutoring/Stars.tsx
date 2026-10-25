import { cn } from "@/lib/utils";

export function Stars({ value, className }: { value: number; className?: string }) {
  const full = Math.round(value);
  return <span role="img" aria-label={`${value.toFixed(1)} sur 5`} className={cn("tracking-tight text-amber-500", className)}>{"★".repeat(full)}<span className="text-muted-foreground/40">{"★".repeat(5 - full)}</span></span>;
}

/** Sélecteur de note 1 à 5 accessible au clavier. */
export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Note" className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} sur 5`} onClick={() => onChange(n)}
          className={cn("rounded-md px-1 text-3xl leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", n <= value ? "text-amber-500" : "text-muted-foreground/40")}>★</button>
      ))}
    </div>
  );
}
