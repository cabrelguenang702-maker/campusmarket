import { BookOpen, GraduationCap, Laptop, Sparkles, Store, Zap, type IconType } from "@/components/icons";

/* Modèle d'affichage de Campus Academy : types, libellés et aides pures (aucun accès réseau ici). */

export type ModuleKind = "video" | "pdf" | "article";
export type Level = "Débutant" | "Intermédiaire" | "Avancé";

export type CourseModule = { id: string; title: string; kind: ModuleKind; minutes: number; preview: boolean };

export type Course = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  /** Libellé de la catégorie (« Design ») et son identifiant (« design »). */
  category: string;
  categorySlug: string;
  level: Level;
  instructor: { name: string; role: string; bio: string };
  /** 0 = gratuit */
  price: number;
  students: number;
  rating: number;
  reviews: number;
  updatedAt: string;
  icon: IconType;
  tone: string;
  learn: string[];
  requirements: string[];
  modules: CourseModule[];
};

export type ArticleBlock = { type: "h" | "p" | "callout" | "code" | "list"; text?: string; items?: string[] };

export const levelFromDb: Record<string, Level> = { debutant: "Débutant", intermediaire: "Intermédiaire", avance: "Avancé" };

/** Habillage visuel par catégorie (le catalogue n'a pas de vignette propre). */
const categoryStyle: Record<string, { icon: IconType; tone: string }> = {
  design: { icon: Sparkles, tone: "from-fuchsia-400/30 to-blue-800/30" },
  developpement: { icon: Laptop, tone: "from-cyan-400/30 to-indigo-800/30" },
  mathematiques: { icon: GraduationCap, tone: "from-blue-300/30 to-violet-900/30" },
  entrepreneuriat: { icon: Store, tone: "from-amber-300/30 to-blue-900/30" },
  bureautique: { icon: BookOpen, tone: "from-emerald-300/30 to-blue-900/30" },
  marketing: { icon: Zap, tone: "from-rose-300/30 to-indigo-900/30" },
};
export const styleOfCategory = (slug: string) => categoryStyle[slug] ?? { icon: BookOpen, tone: "from-sky-300/30 to-blue-900/30" };

export const kindMeta: Record<ModuleKind, { label: string }> = {
  video: { label: "Vidéo" },
  pdf: { label: "Document PDF" },
  article: { label: "Article" },
};

export function courseMinutes(c: Pick<Course, "modules">) {
  return c.modules.reduce((n, mod) => n + mod.minutes, 0);
}

export function formatDuration(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}

/** « Mise à jour en septembre 2026 » */
export function updatedLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `Mise à jour en ${d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}`;
}

export type Progress = { done: number; total: number; pct: number; complete: boolean };

/** Progression d'une personne dans une formation, à partir de l'ensemble des modules qu'elle a terminés. */
export function courseProgress(course: Pick<Course, "modules">, completed: ReadonlySet<string>): Progress {
  const total = course.modules.length;
  const done = course.modules.filter((m) => completed.has(m.id)).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0, complete: total > 0 && done >= total };
}

/** Premier module non terminé (ou undefined si tout est fait). */
export function nextModule(course: Pick<Course, "modules">, completed: ReadonlySet<string>): CourseModule | undefined {
  return course.modules.find((m) => !completed.has(m.id));
}

/** Un module est ouvert si c'est un aperçu, ou si la personne est inscrite et a terminé le précédent (ou celui-ci). */
export function isModuleOpen(course: Pick<Course, "modules">, index: number, enrolled: boolean, completed: ReadonlySet<string>): boolean {
  const m = course.modules[index];
  if (!m) return false;
  if (m.preview) return true;
  if (!enrolled) return false;
  const prev = course.modules[index - 1];
  return index === 0 || !prev || completed.has(prev.id) || completed.has(m.id);
}

/** Numéro affiché sur le certificat à partir du code stocké en base. */
export const certificateNumber = (code: string) => `CM-${code.toUpperCase()}`;
