import * as Icons from "@/components/icons";
import { cn } from "@/lib/utils";
import { useThemeState, type ThemeMode } from "@/lib/theme";
import { Logo } from "@/components/cm/brand";
import { Block } from "./Block";

const swatches = [
  ["background", "bg-background", "Fond de page"],
  ["card", "bg-card", "Cartes, champs"],
  ["secondary", "bg-secondary", "Surfaces secondaires"],
  ["muted", "bg-muted", "Squelettes, pistes"],
  ["accent", "bg-accent", "Pastilles d'icônes"],
  ["primary", "bg-primary", "Action principale"],
  ["success", "bg-success", "Succès, en stock"],
  ["warning", "bg-warning", "Attente, alerte"],
  ["info", "bg-info", "Information"],
  ["destructive", "bg-destructive", "Erreur, suppression"],
  ["border", "bg-border", "Contours"],
  ["foreground", "bg-foreground", "Texte principal"],
] as const;

const themeChoices: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "Clair" },
  { id: "dark", label: "Sombre" },
  { id: "system", label: "Automatique" },
];

export function Foundations() {
  const { mode, setMode } = useThemeState();
  const iconEntries = (Object.entries(Icons).filter(([name]) => /^[A-Z]/.test(name)) as [string, React.ComponentType<{ className?: string }>][]).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div>
      <Block title="Identité" description="Bleu nuit et cyan : la marque reste reconnaissable en thème clair comme en thème sombre.">
        <div className="flex flex-wrap items-center gap-8"><Logo size="lg" /><Logo size="md" showTagline={false} /><Logo size="sm" showTagline={false} /></div>
      </Block>

      <Block title="Thème" description="Clair, sombre ou automatique (suit l'appareil). Le choix est mémorisé et appliqué avant le premier rendu.">
        <div className="inline-flex rounded-lg bg-muted p-1" role="radiogroup" aria-label="Thème">
          {themeChoices.map((t) => (
            <button key={t.id} role="radio" aria-checked={mode === t.id} onClick={() => setMode(t.id)} className={cn("rounded-md px-4 py-2 text-sm font-semibold transition", mode === t.id ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground")}>{t.label}</button>
          ))}
        </div>
      </Block>

      <Block title="Couleurs" description="Toutes les couleurs sont des tokens sémantiques (oklch). Aucune valeur de couleur en dur dans les écrans.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {swatches.map(([name, cls, use]) => (
            <div key={name} className="overflow-hidden rounded-lg border border-border">
              <div className={cn("h-16", cls)} />
              <div className="bg-card p-2.5"><p className="text-xs font-bold">{name}</p><p className="text-[11px] text-muted-foreground">{use}</p></div>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Typographie" description="Sora pour les titres, Manrope pour le texte.">
        <div className="space-y-4">
          <p className="font-display text-4xl font-bold leading-tight">Titre 1 — Sora 700</p>
          <p className="font-display text-2xl font-bold">Titre 2 — Le campus qui échange</p>
          <p className="font-display text-xl font-bold">Titre 3 — Annonces récentes</p>
          <p className="text-base">Texte courant — Manrope 400, lisible sur mobile comme sur desktop.</p>
          <p className="text-sm text-muted-foreground">Texte secondaire — descriptions, aides et métadonnées.</p>
          <p className="section-kicker">Sur-titre de section</p>
        </div>
      </Block>

      <Block title="Rayons et ombres">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[["rounded-md", "Champs, boutons"], ["rounded-lg", "Cartes"], ["rounded-2xl", "Pastilles, héros"], ["rounded-full", "Badges, avatars"]].map(([r, l]) => (
            <div key={r} className="text-center"><div className={cn("mx-auto h-16 w-full border border-primary/40 bg-primary/10", r)} /><p className="mt-2 text-[11px] text-muted-foreground">{l}</p></div>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-3 gap-4">
          {[["shadow-soft", "Douce"], ["shadow-glow", "Halo marque"], ["shadow-panel", "Panneau"]].map(([s, l]) => (
            <div key={s} className={cn("grid h-16 place-items-center rounded-lg bg-card text-xs font-semibold", s)}>{l}</div>
          ))}
        </div>
      </Block>

      <Block title={`Icônes — ${iconEntries.length} Boxicons`} description="Uniquement des icônes du paquet officiel @boxicons/react, importées depuis @/components/icons. Aucune icône dessinée à la main, aucun emoji.">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {iconEntries.map(([name, Icon]) => (
            <div key={name} title={name} className="flex flex-col items-center gap-1.5 rounded-md border border-border p-2.5 text-center">
              <Icon className="size-6 text-primary" />
              <span className="w-full truncate text-[9px] text-muted-foreground">{name}</span>
            </div>
          ))}
        </div>
      </Block>
    </div>
  );
}
