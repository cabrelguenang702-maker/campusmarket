import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Bloc de documentation du design system : titre, description, aperçu. */
export function Block({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className="mb-8">
      <h3 className="font-display text-lg font-bold">{title}</h3>
      {description && <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
      <div className={cn("mt-4 rounded-xl border border-border bg-card p-4 sm:p-5", className)}>{children}</div>
    </section>
  );
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-3", className)}>{children}</div>;
}
