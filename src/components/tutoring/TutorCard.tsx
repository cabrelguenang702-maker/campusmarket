import { AppLink } from "@/components/cm/app-link";
import { BadgeCheck } from "@/components/icons";
import { formatFcfa } from "@/lib/domain";
import { MODE_LABEL, type Tutor } from "@/lib/api/tutoring";
import { Stars } from "./Stars";

export function TutorCardSkeleton() {
  return <div aria-hidden className="h-52 animate-pulse rounded-xl border border-border bg-card" />;
}

export function TutorCard({ tutor }: { tutor: Tutor }) {
  const sub = [tutor.filiere, tutor.niveau, tutor.university].filter(Boolean).join(" · ");
  return (
    <AppLink to={`/tutorat/${tutor.userId}`} className="group flex h-full flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-lg font-bold text-primary">{tutor.name.charAt(0).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-display font-bold leading-tight group-hover:text-primary"><span className="truncate">{tutor.name}</span>{tutor.verified && <BadgeCheck className="size-4 shrink-0 text-primary" aria-label="Profil vérifié" />}</p>
          {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {tutor.subjects.slice(0, 4).map((s) => <span key={s} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold">{s}</span>)}
        {tutor.subjects.length > 4 && <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground">+{tutor.subjects.length - 4}</span>}
      </div>
      {tutor.bio && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{tutor.bio}</p>}
      <div className="mt-auto flex items-end justify-between gap-2 pt-3 text-xs text-muted-foreground">
        <div>
          {tutor.reviewsCount > 0 ? <p className="flex items-center gap-1.5"><Stars value={tutor.rating} /> <span>{tutor.rating.toFixed(1)} ({tutor.reviewsCount} avis)</span></p> : <p>Nouveau tuteur</p>}
          <p>{MODE_LABEL[tutor.mode]}</p>
        </div>
        <p className="text-sm font-bold text-foreground">{tutor.hourlyPrice > 0 ? `${formatFcfa(tutor.hourlyPrice)} / h` : "Gratuit"}</p>
      </div>
    </AppLink>
  );
}
