import { cn } from "@/lib/utils";
import { BookOpen, CheckCircle, Clock, Star, Users } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { courseMinutes, formatDuration, type Course, type Level, type Progress } from "@/lib/academy-model";
import { formatFcfa } from "@/lib/domain";

export function ProgressBar({ pct, className, label }: { pct: number; className?: string; label?: string }) {
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label ?? "Progression"}>
      <div className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function LevelPill({ level }: { level: Level }) {
  return <Pill tone={level === "Débutant" ? "success" : level === "Intermédiaire" ? "info" : "warning"}>{level}</Pill>;
}

export function PriceTag({ price, className }: { price: number; className?: string }) {
  return price === 0
    ? <span className={cn("font-display font-bold text-[oklch(0.42_0.13_155)] dark:text-success", className)}>Gratuit</span>
    : <span className={cn("font-display font-bold text-primary", className)}>{formatFcfa(price)}</span>;
}

/** Vignette d'une formation : visuel, niveau, prix, métadonnées et progression (fournie seulement si la personne est inscrite). */
export function CourseCard({ course, progress }: { course: Course; progress?: Progress | undefined }) {
  const enrolled = progress !== undefined;
  const p = progress ?? { done: 0, total: course.modules.length, pct: 0, complete: false };
  const Icon = course.icon;
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:border-primary/40 hover:shadow-glow">
      <AppLink to={`/formations/${course.id}`} className="relative block" aria-label={`Voir la formation ${course.title}`}>
        <div className={cn("relative grid h-36 place-items-center bg-gradient-to-br", course.tone)}>
          <div className="dot-grid absolute inset-0 opacity-40" />
          <Icon className="relative size-14 text-primary" />
        </div>
        <span className="absolute left-3 top-3"><LevelPill level={course.level} /></span>
        {p.complete && <span className="absolute right-3 top-3"><Pill tone="success" icon={CheckCircle}>Terminée</Pill></span>}
      </AppLink>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-primary">{course.category}</p>
        <AppLink to={`/formations/${course.id}`}><h3 className="mt-1 font-display text-base font-bold leading-snug group-hover:text-primary">{course.title}</h3></AppLink>
        <p className="mt-1 text-xs text-muted-foreground">{course.instructor.name}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Star pack="filled" className="size-3.5 text-warning" />{course.reviews > 0 ? <><b className="text-foreground">{course.rating.toString().replace(".", ",")}</b> ({course.reviews})</> : <span>Pas encore d'avis</span>}</span>
          <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{formatDuration(courseMinutes(course))}</span>
          <span className="inline-flex items-center gap-1"><BookOpen className="size-3.5" />{course.modules.length} modules</span>
        </div>
        <div className="mt-auto pt-4">
          {enrolled ? (
            <div><div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-semibold">{p.complete ? "Formation terminée" : `${p.done}/${p.total} modules`}</span><span className="font-bold text-primary">{p.pct} %</span></div><ProgressBar pct={p.pct} label={`Progression : ${course.title}`} /></div>
          ) : (
            <div className="flex items-center justify-between border-t border-border pt-3"><PriceTag price={course.price} className="text-base" /><span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Users className="size-3.5" />{course.students.toLocaleString("fr-FR")}</span></div>
          )}
        </div>
      </div>
    </article>
  );
}

export function CourseCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card" aria-hidden>
      <div className="h-36 animate-pulse bg-foreground/10" />
      <div className="space-y-3 p-4"><div className="h-3 w-1/4 animate-pulse rounded bg-foreground/10" /><div className="h-5 w-4/5 animate-pulse rounded bg-foreground/10" /><div className="h-3 w-1/2 animate-pulse rounded bg-foreground/10" /><div className="h-3 w-full animate-pulse rounded bg-foreground/10" /></div>
    </div>
  );
}
