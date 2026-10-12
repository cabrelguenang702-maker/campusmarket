import { Pill } from "@/components/cm/badges";
import { phases, plannedRoutes } from "@/lib/planned-routes";
import { cn } from "@/lib/utils";
import { Check } from "@/components/icons";
import { Block } from "./Block";

export function ProgressSection() {
  const remaining = plannedRoutes.length;
  return (
    <div>
      <Block title="Avancement du master" description={`${remaining} routes du master restent à concevoir. Chaque route non construite affiche un écran « en cours de conception ».`}>
        <ol className="space-y-2">
          {phases.map((p) => (
            <li key={p.id} className={cn("flex items-center gap-3 rounded-lg border p-3", p.status === "next" ? "border-primary/40 bg-primary/5" : "border-border")}>
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold", p.status === "done" ? "bg-success/15 text-success" : p.status === "next" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                {p.status === "done" ? <Check className="size-4" /> : p.id}
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold">{p.title}</span>
              <Pill tone={p.status === "done" ? "success" : p.status === "next" ? "primary" : "neutral"}>{p.status === "done" ? "Terminée" : p.status === "next" ? "Prochaine" : "À venir"}</Pill>
            </li>
          ))}
        </ol>
      </Block>
      <Block title="Composants du design system encore à créer" description="Ils arrivent avec les écrans qui les utilisent, pour être dessinés dans leur vrai contexte.">
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {[["Publication, commentaire, réaction", "Phase 6"], ["Conversation et message", "Phase 4"], ["Carte formation et progression", "Phase 5"], ["Carte événement et billet électronique", "Phase 6"], ["Ticket support et statuts", "Phase 7"], ["Tableau, filtres et graphiques admin", "Phase 8"]].map(([n, ph]) => (
            <li key={n} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5"><span>{n}</span><Pill>{ph}</Pill></li>
          ))}
        </ul>
      </Block>
    </div>
  );
}
