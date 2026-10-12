import { cn } from "@/lib/utils";
import { Globe, Lock } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { isMember, kindLabels, memberLabel, type MyStatus, type Privacy, type Space } from "@/lib/spaces-model";

export function PrivacyPill({ privacy }: { privacy: Privacy }) {
  return privacy === "publique" ? <Pill tone="primary" icon={Globe}>Publique</Pill> : <Pill tone="neutral" icon={Lock}>{privacy === "invitation" ? "Sur invitation" : "Privée"}</Pill>;
}

/** Carte d'une communauté ou d'un groupe (grille de listing). */
export function SpaceCard({ space, status }: { space: Space; status: MyStatus }) {
  const Icon = space.icon;
  const base = kindLabels[space.kind].basePath;
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:border-primary/40 hover:shadow-glow">
      <AppLink to={`${base}/${space.id}`} className="relative block" aria-label={`Voir ${space.name}`}>
        <div className={cn("relative grid h-28 place-items-center bg-gradient-to-br", space.tone)}><div className="dot-grid absolute inset-0 opacity-40" /><Icon className="relative size-11 text-primary" /></div>
        <span className="absolute left-3 top-3"><PrivacyPill privacy={space.privacy} /></span>
        {isMember(status) && <span className="absolute right-3 top-3"><Pill tone="success">Membre</Pill></span>}
        {status === "attente" && <span className="absolute right-3 top-3"><Pill tone="warning">Demande envoyée</Pill></span>}
      </AppLink>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-primary">{space.category}</p>
        <AppLink to={`${base}/${space.id}`}><h3 className="mt-1 font-display text-base font-bold leading-snug group-hover:text-primary">{space.name}</h3></AppLink>
        <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{space.description}</p>
        <p className="mt-auto pt-4 text-xs font-semibold text-muted-foreground">{memberLabel(space.memberCount)}</p>
      </div>
    </article>
  );
}

export function SpaceCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card" aria-hidden>
      <div className="h-28 animate-pulse bg-foreground/10" />
      <div className="space-y-3 p-4"><div className="h-3 w-1/3 animate-pulse rounded bg-foreground/10" /><div className="h-5 w-4/5 animate-pulse rounded bg-foreground/10" /><div className="h-3 w-full animate-pulse rounded bg-foreground/10" /></div>
    </div>
  );
}
