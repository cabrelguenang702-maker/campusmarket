import { AppLink } from "@/components/cm/app-link";
import { BookOpen, Users } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { StudyGroup } from "@/lib/api/study-groups";

export function GroupCardSkeleton() {
  return <div aria-hidden className="h-44 animate-pulse rounded-xl border border-border bg-card" />;
}

export function GroupCard({ group }: { group: StudyGroup }) {
  const full = group.memberCount >= group.maxMembers;
  const fill = Math.min(100, Math.round((group.memberCount / group.maxMembers) * 100));
  return (
    <AppLink to={`/revision/${group.id}`} className="group flex flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex items-start justify-between gap-2">
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold">{group.subject}</span>
        {group.isMember && <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">{group.isOwner ? "Votre groupe" : "Membre"}</span>}
        {!group.isMember && full && <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">Complet</span>}
      </div>
      <h3 className="mt-3 font-display text-base font-bold leading-snug group-hover:text-primary">{group.title}</h3>
      {group.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{group.description}</p>}
      <div className="mt-auto pt-4">
        {group.courseTitle && <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><BookOpen className="size-3.5 shrink-0" /> <span className="truncate">{group.courseTitle}</span></p>}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><Users className="size-3.5" /> {group.memberCount} / {group.maxMembers}</span>
          <span className="truncate pl-2">{group.universityName ?? group.ownerName ?? ""}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden><div className={cn("h-full rounded-full", full ? "bg-muted-foreground" : "bg-primary")} style={{ width: `${fill}%` }} /></div>
      </div>
    </AppLink>
  );
}
