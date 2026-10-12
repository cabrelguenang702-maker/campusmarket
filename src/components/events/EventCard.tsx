import { cn } from "@/lib/utils";
import { CalendarDays, MapPin, Ticket } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { formatFcfa } from "@/lib/domain";
import { remaining, type EventItem } from "@/lib/events-model";

export function EventStatusPill({ event }: { event: EventItem }) {
  if (event.dbStatus === "draft") return <Pill tone="warning">Brouillon</Pill>;
  if (event.status === "termine") return <Pill tone="neutral">Terminé</Pill>;
  if (event.status === "annule") return <Pill tone="danger">Annulé</Pill>;
  if (event.status === "complet") return <Pill tone="warning">Complet</Pill>;
  return event.price === 0 ? <Pill tone="success">Gratuit</Pill> : <Pill tone="primary">{formatFcfa(event.price)}</Pill>;
}

/** Vignette d'un événement. `registered` : la personne connectée a un billet valide. */
export function EventCard({ event, registered = false }: { event: EventItem; registered?: boolean }) {
  const Icon = event.icon;
  const left = remaining(event);
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:border-primary/40 hover:shadow-glow">
      <AppLink to={`/evenements/${event.id}`} className="relative block" aria-label={`Voir ${event.name}`}>
        <div className={cn("relative grid h-28 place-items-center bg-gradient-to-br", event.tone)}><div className="dot-grid absolute inset-0 opacity-40" /><Icon className="relative size-11 text-primary" /></div>
        <span className="absolute left-3 top-3"><EventStatusPill event={event} /></span>
        {registered && <span className="absolute right-3 top-3"><Pill tone="success" icon={Ticket}>Inscrit</Pill></span>}
      </AppLink>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-primary">{event.category}</p>
        <AppLink to={`/evenements/${event.id}`}><h3 className="mt-1 font-display text-base font-bold leading-snug group-hover:text-primary">{event.name}</h3></AppLink>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5 shrink-0 text-primary" />{event.dateLabel}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="size-3.5 shrink-0 text-primary" />{event.place} · {event.campus}</p>
        <p className="mt-auto pt-4 text-xs font-semibold text-muted-foreground">{left} place{left > 1 ? "s" : ""} restante{left > 1 ? "s" : ""}</p>
      </div>
    </article>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card" aria-hidden>
      <div className="h-28 animate-pulse bg-foreground/10" />
      <div className="space-y-3 p-4"><div className="h-3 w-1/3 animate-pulse rounded bg-foreground/10" /><div className="h-5 w-4/5 animate-pulse rounded bg-foreground/10" /><div className="h-3 w-full animate-pulse rounded bg-foreground/10" /></div>
    </div>
  );
}
