import type { ReactNode } from "react";
import { LEGAL } from "@/lib/legal";
import { InlineAlert } from "@/components/cm/feedback";

/** Valeur à compléter : tout texte entre crochets s'affiche en surbrillance jaune pour ne pas passer inaperçu. */
export function Fill({ children }: { children: ReactNode }) {
  const text = typeof children === "string" ? children : "";
  const isTodo = text.startsWith("[");
  return isTodo
    ? <mark className="rounded bg-yellow-200 px-1 py-0.5 text-[0.92em] font-medium text-black dark:bg-yellow-300">{children}</mark>
    : <>{children}</>;
}

export type LegalSection = { title: string; body: ReactNode };

/** Gabarit d'une page légale : titre, bandeau « brouillon » tant que le texte n'est pas validé, sommaire, articles numérotés. */
export function LegalDoc({ title, intro, sections }: { title: string; intro?: ReactNode; sections: LegalSection[] }) {
  return (
    <article>
      <h1 className="font-display text-3xl font-bold leading-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Dernière mise à jour : {LEGAL.lastUpdate}</p>

      {!LEGAL.reviewed && (
        <div className="mt-5">
          <InlineAlert tone="warning" title="Texte provisoire">
            Ce document est un brouillon en attente de validation juridique. Les passages en surbrillance jaune restent à compléter. Il ne doit pas être considéré comme définitif.
          </InlineAlert>
        </div>
      )}

      {intro && <div className="mt-5 space-y-3 text-sm leading-6">{intro}</div>}

      <nav aria-label="Sommaire" className="mt-6 rounded-xl border border-border bg-secondary/50 p-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Sommaire</p>
        <ol className="space-y-1 text-sm">
          {sections.map((s, i) => (
            <li key={s.title}><a href={`#article-${i + 1}`} className="text-primary hover:underline">{i + 1}. {s.title}</a></li>
          ))}
        </ol>
      </nav>

      <div className="mt-8 space-y-8">
        {sections.map((s, i) => (
          <section key={s.title} id={`article-${i + 1}`} className="scroll-mt-20">
            <h2 className="font-display text-xl font-bold">{i + 1}. {s.title}</h2>
            <div className="mt-2 space-y-3 text-sm leading-6 [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">{s.body}</div>
          </section>
        ))}
      </div>
    </article>
  );
}
