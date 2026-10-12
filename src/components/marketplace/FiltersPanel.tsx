import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ChevronDown } from "@/components/icons";
import { cn } from "@/lib/utils";
import { countActiveFilters, defaultFilters, PRICE_MAX, type Filters } from "@/lib/catalog";
import { conditions, formatFcfa } from "@/lib/domain";
import { useListingCampuses } from "@/lib/api/products";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border py-4 first:pt-0 last:border-0">
      <p className="mb-3 text-[13px] font-bold">{title}</p>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold transition", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground")}>
      {children}
    </button>
  );
}

/** Formulaire de filtres partagé entre la colonne desktop et la feuille du bas mobile. */
export function FiltersPanel({ filters, onChange, advanced, onAdvancedChange, idPrefix = "f" }: {
  filters: Filters;
  onChange: (f: Filters) => void;
  advanced: boolean;
  onAdvancedChange: (v: boolean) => void;
  idPrefix?: string;
}) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  const toggleEtat = (etat: (typeof conditions)[number]) => set("etats", filters.etats.includes(etat) ? filters.etats.filter((e) => e !== etat) : [...filters.etats, etat]);
  const active = countActiveFilters(filters);
  const campusOptions = useListingCampuses().data ?? [];

  return (
    <div>
      <Section title="Prix">
        <Slider value={[filters.min, filters.max]} min={0} max={PRICE_MAX} step={5000} minStepsBetweenThumbs={1} onValueChange={([min = 0, max = PRICE_MAX]) => onChange({ ...filters, min, max })} aria-label="Fourchette de prix" />
        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          <span className="rounded-md bg-secondary px-2.5 py-1.5 font-semibold">{formatFcfa(filters.min)}</span>
          <span className="text-muted-foreground">à</span>
          <span className="rounded-md bg-secondary px-2.5 py-1.5 font-semibold">{filters.max >= PRICE_MAX ? `${formatFcfa(PRICE_MAX)}+` : formatFcfa(filters.max)}</span>
        </div>
      </Section>

      <Section title="État de l'article">
        <div className="space-y-2.5">
          {conditions.map((c) => (
            <div key={c} className="flex items-center gap-2.5"><Checkbox id={`${idPrefix}-etat-${c}`} checked={filters.etats.includes(c)} onCheckedChange={() => toggleEtat(c)} /><Label htmlFor={`${idPrefix}-etat-${c}`} className="text-sm font-normal">{c}</Label></div>
          ))}
        </div>
      </Section>

      <Section title="Campus">
        <Select value={filters.campus} onValueChange={(v) => set("campus", v)}>
          <SelectTrigger className="h-10 bg-card" aria-label="Campus"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="tous">Tous les campus</SelectItem>
            {campusOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </Section>

      <Section title="Options">
        <div className="space-y-3.5">
          {([["dispo", "Annonces disponibles uniquement"], ["verifie", "Vendeurs vérifiés"], ["negociable", "Prix négociable"]] as const).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3"><Label htmlFor={`${idPrefix}-${key}`} className="text-sm font-normal">{label}</Label><Switch id={`${idPrefix}-${key}`} checked={filters[key]} onCheckedChange={(v) => set(key, v)} /></div>
          ))}
        </div>
      </Section>

      <button type="button" onClick={() => onAdvancedChange(!advanced)} aria-expanded={advanced} className="flex w-full items-center justify-between py-3 text-[13px] font-bold text-primary">
        Filtres avancés
        <ChevronDown className={cn("size-4 transition-transform", advanced && "rotate-180")} />
      </button>
      {advanced && (
        <div className="fade-up rounded-lg border border-border bg-secondary/40 px-3">
          <Section title="Note minimale du vendeur">
            <div className="flex flex-wrap gap-2">{[[0, "Toutes"], [3, "3+"], [4, "4+"], [4.5, "4,5+"]].map(([v, l]) => <Chip key={String(v)} active={filters.noteMin === v} onClick={() => set("noteMin", Number(v))}>{l}</Chip>)}</div>
          </Section>
          <Section title="Publiée depuis">
            <div className="flex flex-wrap gap-2">{([["tous", "Toujours"], ["1", "24 heures"], ["7", "7 jours"], ["30", "30 jours"]] as const).map(([v, l]) => <Chip key={v} active={filters.fraicheur === v} onClick={() => set("fraicheur", v)}>{l}</Chip>)}</div>
          </Section>
        </div>
      )}

      <Button type="button" variant="ghost" className="mt-3 w-full" disabled={active === 0} onClick={() => onChange(defaultFilters)}>Réinitialiser les filtres{active > 0 ? ` (${active})` : ""}</Button>
    </div>
  );
}
