import { AppLink } from "@/components/cm/app-link";
import { Buildings, MapPin, Users } from "@/components/icons";
import type { DirectoryUniversity } from "@/lib/api/universities";

export function UniversityCard({ u }: { u: DirectoryUniversity }) {
  return (
    <AppLink to={`/universites/${u.id}`} className="group flex items-start gap-3.5 rounded-xl border border-border bg-card p-4 transition hover:border-primary/40 hover:shadow-glow">
      <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Buildings className="size-6" /></span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[15px] font-bold leading-snug group-hover:text-primary">{u.name}</p>
        <p className="mt-0.5 text-xs font-semibold text-muted-foreground">{u.short}</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="size-3.5 shrink-0" />{u.city} · {u.flag} {u.countryName}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="size-3.5 shrink-0" />{u.students}</p>
      </div>
    </AppLink>
  );
}

export function UniversityCardSkeleton() {
  return (
    <div className="flex items-start gap-3.5 rounded-xl border border-border bg-card p-4" aria-hidden>
      <div className="size-12 shrink-0 animate-pulse rounded-lg bg-foreground/10" />
      <div className="flex-1 space-y-2"><div className="h-4 w-3/4 animate-pulse rounded bg-foreground/10" /><div className="h-3 w-1/3 animate-pulse rounded bg-foreground/10" /><div className="h-3 w-1/2 animate-pulse rounded bg-foreground/10" /></div>
    </div>
  );
}
