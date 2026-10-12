import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Clock, Download, Fullscreen } from "@/components/icons";
import { StateScreen } from "@/components/cm/feedback";
import { Spinner } from "@/components/cm/feedback";
import { Lock } from "@/components/icons";
import type { ArticleBlock, CourseModule } from "@/lib/academy-model";
import type { ModuleContent } from "@/lib/api/academy";

/* Lecteurs de contenu. Les fichiers (vidéo, PDF) viennent du bucket privé course-media par URL signée (1 h) ; les
 * articles sont des blocs structurés stockés en base. Aucun contenu n'est simulé. */

export function ContentLoading() {
  return <div className="grid aspect-video place-items-center rounded-xl border border-border bg-card" aria-busy><Spinner className="size-6" /></div>;
}

export function ContentMissing({ onRetry, error = false }: { onRetry?: () => void; error?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <StateScreen compact icon={Lock} tone={error ? "danger" : "neutral"} title={error ? "Impossible de charger ce contenu" : "Contenu bientôt disponible"}
        description={error ? "Vérifiez votre connexion puis réessayez." : "Le formateur n'a pas encore publié le contenu de ce module. Revenez bientôt."}
        actions={onRetry ? <Button variant="outline" onClick={onRetry}>Réessayer</Button> : undefined} />
    </div>
  );
}

/** Vidéo : lecteur natif du navigateur (lecture, position, vitesse, plein écran selon le navigateur). */
export function VideoPlayer({ title, url, onEnded }: { title: string; url: string; onEnded?: (() => void) | undefined }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-black">
      <video key={url} src={url} controls controlsList="nodownload" playsInline preload="metadata" aria-label={title} className="aspect-video w-full bg-black" onEnded={onEnded}>
        Votre navigateur ne sait pas lire cette vidéo.
      </video>
    </div>
  );
}

/** PDF : affichage par le lecteur intégré du navigateur, avec ouverture dans un onglet et téléchargement. */
export function PdfViewer({ title, url }: { title: string; url: string }) {
  const box = useRef<HTMLDivElement>(null);
  return (
    <div ref={box} className="overflow-hidden rounded-xl border border-border bg-muted/50">
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-card px-3 py-2">
        <span className="truncate px-1 text-sm font-semibold">{title}</span>
        <span className="ml-auto flex items-center gap-1">
          <Button asChild variant="ghost" size="icon" aria-label="Télécharger le PDF"><a href={url} download={`${title}.pdf`} target="_blank" rel="noopener noreferrer"><Download /></a></Button>
          <Button variant="ghost" size="icon" aria-label="Plein écran" onClick={() => { void box.current?.requestFullscreen?.(); }}><Fullscreen /></Button>
        </span>
      </div>
      <iframe key={url} src={url} title={title} className="h-[70vh] w-full bg-white" />
      <p className="border-t border-border bg-card px-3 py-2 text-xs text-muted-foreground">Le document ne s'affiche pas ? <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">Ouvrez-le dans un nouvel onglet</a>.</p>
    </div>
  );
}

/** Article : blocs structurés et barre de progression de lecture. */
export function ArticleViewer({ title, minutes, blocks, onFinished }: { title: string; minutes: number; blocks: ArticleBlock[]; onFinished?: (() => void) | undefined }) {
  const ref = useRef<HTMLElement>(null);
  const [read, setRead] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const max = r.height - window.innerHeight;
      const pct = max <= 0 ? (r.bottom <= window.innerHeight ? 100 : 0) : (-r.top / max) * 100;
      setRead(Math.round(Math.min(100, Math.max(0, pct))));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => { if (read >= 95) onFinished?.(); }, [read, onFinished]);
  return (
    <article ref={ref} className="rounded-xl border border-border bg-card">
      <div className="sticky top-16 z-10 h-1 overflow-hidden rounded-t-xl bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${read}%` }} /></div>
      <div className="px-5 py-6 sm:px-8">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="size-3.5" /> {minutes} min de lecture</p>
        <h2 className="mt-2 font-display text-2xl font-bold">{title}</h2>
        <div className="mt-5 space-y-4 text-[15px] leading-7">
          {blocks.map((b, i) => {
            if (b.type === "h") return <h3 key={i} className="pt-2 font-display text-lg font-bold">{b.text}</h3>;
            if (b.type === "callout") return <p key={i} className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm">{b.text}</p>;
            if (b.type === "code") return <pre key={i} className="overflow-x-auto rounded-lg bg-[#0b1220] p-4 text-xs leading-6 text-[#d7e6f7]"><code>{b.text}</code></pre>;
            if (b.type === "list") return <ul key={i} className="list-disc space-y-1.5 pl-5 text-muted-foreground">{b.items?.map((it, k) => <li key={k}>{it}</li>)}</ul>;
            return <p key={i} className="text-muted-foreground">{b.text}</p>;
          })}
        </div>
      </div>
    </article>
  );
}

/** Choisit le bon lecteur pour un contenu déjà chargé. */
export function ContentPlayer({ mod, content, onEnded }: { mod: CourseModule; content: ModuleContent; onEnded?: (() => void) | undefined }) {
  if (content.kind === "video" && content.url) return <VideoPlayer title={mod.title} url={content.url} onEnded={onEnded} />;
  if (content.kind === "pdf" && content.url) return <PdfViewer title={mod.title} url={content.url} />;
  if (content.kind === "article" && content.article) return <ArticleViewer title={mod.title} minutes={mod.minutes} blocks={content.article} onFinished={onEnded} />;
  return <ContentMissing />;
}
