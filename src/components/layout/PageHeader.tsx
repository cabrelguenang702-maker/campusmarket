import type { ReactNode } from "react";
import { ChevronRight } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; to?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Fil d'Ariane" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1">
            {c.to && i < items.length - 1 ? <AppLink to={c.to} className="hover:text-primary hover:underline">{c.label}</AppLink> : <span aria-current="page" className="font-semibold text-foreground">{c.label}</span>}
            {i < items.length - 1 && <ChevronRight className="size-3.5" />}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({ kicker, title, description, breadcrumbs, actions, className }: { kicker?: string | undefined; title: string; description?: string | undefined; breadcrumbs?: Crumb[] | undefined; actions?: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn("mb-6", className)}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {kicker && <p className="section-kicker">{kicker}</p>}
          <h1 className="font-display text-2xl font-bold leading-tight sm:text-3xl">{title}</h1>
          {description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function SectionHeader({ kicker, title, action }: { kicker?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        {kicker && <p className="section-kicker">{kicker}</p>}
        <h2 className="font-display text-xl font-bold">{title}</h2>
      </div>
      {action}
    </div>
  );
}
