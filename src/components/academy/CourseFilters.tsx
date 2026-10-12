import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Level } from "@/lib/academy-model";

export type CourseFilterState = {
  niveau: Level | "tous";
  prix: "tous" | "gratuit" | "payant";
  duree: "tous" | "court" | "moyen" | "long";
  note: 0 | 4 | 4.5;
};

export const defaultCourseFilters: CourseFilterState = { niveau: "tous", prix: "tous", duree: "tous", note: 0 };

export const countCourseFilters = (f: CourseFilterState) => [f.niveau !== "tous", f.prix !== "tous", f.duree !== "tous", f.note > 0].filter(Boolean).length;

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="border-b border-border py-4 first:pt-0 last:border-0"><p className="mb-3 text-[13px] font-bold">{title}</p><div className="flex flex-wrap gap-2">{children}</div></div>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold transition", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground")}>{children}</button>;
}

/** Filtres du catalogue (colonne desktop et feuille du bas mobile). */
export function CourseFilters({ value, onChange }: { value: CourseFilterState; onChange: (v: CourseFilterState) => void }) {
  const set = <K extends keyof CourseFilterState>(k: K, v: CourseFilterState[K]) => onChange({ ...value, [k]: v });
  const active = countCourseFilters(value);
  return (
    <div>
      <Group title="Niveau">{(["tous", "Débutant", "Intermédiaire", "Avancé"] as const).map((n) => <Chip key={n} active={value.niveau === n} onClick={() => set("niveau", n)}>{n === "tous" ? "Tous" : n}</Chip>)}</Group>
      <Group title="Prix">{([["tous", "Tous"], ["gratuit", "Gratuites"], ["payant", "Payantes"]] as const).map(([id, l]) => <Chip key={id} active={value.prix === id} onClick={() => set("prix", id)}>{l}</Chip>)}</Group>
      <Group title="Durée">{([["tous", "Toutes"], ["court", "Moins de 1 h 30"], ["moyen", "1 h 30 à 2 h"], ["long", "Plus de 2 h"]] as const).map(([id, l]) => <Chip key={id} active={value.duree === id} onClick={() => set("duree", id)}>{l}</Chip>)}</Group>
      <Group title="Note minimale">{([[0, "Toutes"], [4, "4+"], [4.5, "4,5+"]] as const).map(([id, l]) => <Chip key={id} active={value.note === id} onClick={() => set("note", id)}>{l}</Chip>)}</Group>
      <Button variant="ghost" className="mt-3 w-full" disabled={active === 0} onClick={() => onChange(defaultCourseFilters)}>Réinitialiser les filtres{active ? ` (${active})` : ""}</Button>
    </div>
  );
}
