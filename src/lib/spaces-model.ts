import { Angry, Book, Coffee, Football, Heart, Laptop, Laugh, Palette, Sad, Store, ThumbUp, Users, type IconType } from "@/components/icons";

/* Communautés et groupes : types d'affichage et aides pures (aucun accès réseau ici). */

export type SpaceKind = "communaute" | "groupe";
export type Privacy = "publique" | "privee" | "invitation";
/** Rôle en base : owner > admin > moderator > member. */
export type SpaceRole = "owner" | "admin" | "moderator" | "member";
/** Situation de la personne connectée vis-à-vis d'un espace. */
export type MyStatus = SpaceRole | "attente" | "aucun";

export type Space = {
  id: string;
  kind: SpaceKind;
  name: string;
  description: string;
  categorySlug: string;
  category: string;
  privacy: Privacy;
  rules: string[];
  memberCount: number;
  createdAt: string;
  icon: IconType;
  tone: string;
};

export type ReactionKind = "jaime" | "jadore" | "haha" | "triste" | "grrr";
export const reactionMeta: Record<ReactionKind, { label: string; icon: IconType; className: string }> = {
  jaime: { label: "J'aime", icon: ThumbUp, className: "text-primary" },
  jadore: { label: "J'adore", icon: Heart, className: "text-destructive" },
  haha: { label: "Haha", icon: Laugh, className: "text-warning" },
  triste: { label: "Triste", icon: Sad, className: "text-info" },
  grrr: { label: "Grrr", icon: Angry, className: "text-destructive" },
};
export const reactionKinds = Object.keys(reactionMeta) as ReactionKind[];

const categoryStyle: Record<string, { icon: IconType; tone: string }> = {
  technologie: { icon: Laptop, tone: "from-cyan-400/30 to-blue-900/30" },
  entrepreneuriat: { icon: Store, tone: "from-amber-300/30 to-blue-900/30" },
  "vie-de-campus": { icon: Coffee, tone: "from-orange-300/30 to-indigo-900/30" },
  creativite: { icon: Palette, tone: "from-fuchsia-400/30 to-blue-800/30" },
  classe: { icon: Book, tone: "from-blue-300/30 to-violet-900/30" },
  sport: { icon: Football, tone: "from-emerald-300/30 to-blue-900/30" },
  etudes: { icon: Book, tone: "from-sky-300/30 to-indigo-900/30" },
};
export const styleOfSpaceCategory = (slug: string) => categoryStyle[slug] ?? { icon: Users, tone: "from-sky-300/30 to-blue-900/30" };

export const kindLabels: Record<SpaceKind, { one: string; many: string; the: string; basePath: string; article: string }> = {
  communaute: { one: "communauté", many: "communautés", the: "la communauté", basePath: "/communautes", article: "Une" },
  groupe: { one: "groupe", many: "groupes", the: "le groupe", basePath: "/groupes", article: "Un" },
};

export const isMember = (s: MyStatus) => s === "owner" || s === "admin" || s === "moderator" || s === "member";
export const canModerate = (s: MyStatus) => s === "owner" || s === "admin" || s === "moderator";
export const canAdminister = (s: MyStatus) => s === "owner" || s === "admin";

export const roleLabel: Record<SpaceRole, string> = { owner: "Propriétaire", admin: "Administrateur", moderator: "Modérateur", member: "Membre" };

/** « Créée en janvier 2024 » */
export function createdLabel(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `Créée en ${d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}`;
}

export const memberLabel = (n: number) => `${n.toLocaleString("fr-FR")} membre${n > 1 ? "s" : ""}`;
