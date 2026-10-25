import { BookOpen, Couch, Headphones, Laptop, Smartphone, TShirt, Zap, type IconType } from "@/components/icons";

/* -------------------------------------------------------------------------------------------------
 * Types et constantes métier partagés par l'interface. Ils reflètent la base (enums listing_condition,
 * listing_status, table categories) : toute valeur ici a un équivalent côté Postgres.
 * ------------------------------------------------------------------------------------------------- */

export function formatFcfa(value: number) {
  return `${value.toLocaleString("fr-FR")} FCFA`;
}

export type CategorySlug = "telephones" | "ordinateurs" | "audio" | "livres" | "services" | "mode" | "maison";

export const categories: { slug: CategorySlug; name: string; icon: IconType; tone: string }[] = [
  { slug: "telephones", name: "Téléphones", icon: Smartphone, tone: "from-blue-400/30 to-sky-900/20" },
  { slug: "ordinateurs", name: "Ordinateurs", icon: Laptop, tone: "from-cyan-400/30 to-blue-700/20" },
  { slug: "audio", name: "Audio et accessoires", icon: Headphones, tone: "from-violet-400/30 to-indigo-800/20" },
  { slug: "livres", name: "Livres et fournitures", icon: BookOpen, tone: "from-amber-400/30 to-orange-800/20" },
  { slug: "services", name: "Services et cours", icon: Zap, tone: "from-emerald-400/30 to-teal-800/20" },
  { slug: "mode", name: "Mode", icon: TShirt, tone: "from-pink-400/30 to-rose-800/20" },
  { slug: "maison", name: "Maison et chambre", icon: Couch, tone: "from-lime-400/30 to-green-800/20" },
];

export function categoryOf(slug: string) {
  return categories.find((c) => c.slug === slug) ?? categories[0]!;
}

export const conditions = ["Neuf", "Très bon état", "Bon état", "Occasion"] as const;
export type Condition = (typeof conditions)[number];

/** Valeurs de l'enum Postgres listing_condition, dans le même ordre que `conditions`. */
export const dbConditions = ["neuf", "tres_bon_etat", "bon_etat", "occasion"] as const;
export type DbCondition = (typeof dbConditions)[number];

export function conditionFromDb(value: string): Condition {
  const i = dbConditions.indexOf(value as DbCondition);
  return conditions[i >= 0 ? i : 3]!;
}
export function conditionToDb(value: Condition): DbCondition {
  return dbConditions[conditions.indexOf(value)]!;
}

/** Valeurs de l'enum Postgres listing_status. */
export type ListingStatus = "draft" | "published" | "pending_review" | "sold" | "archived" | "removed";

/** État de disponibilité affiché sur une carte (déduit du statut et du stock réel). */
export type Stock = "available" | "low" | "reserved" | "sold" | "expired";

export type Product = {
  id: string;
  name: string;
  price: number;
  oldPrice?: number | undefined;
  campus: string;
  city: string;
  condition: Condition;
  status: ListingStatus;
  sellerId: string;
  sellerName: string;
  sellerCampus: string;
  sellerVerified: boolean;
  sellerAvatarUrl: string | null;
  /** Note moyenne et nombre d'avis du VENDEUR. */
  rating: number;
  reviews: number;
  posted: string;
  /** Ancienneté en jours. */
  postedDays: number;
  stock: Stock;
  icon: IconType;
  tone: string;
  category: CategorySlug;
  negotiable: boolean;
  /** Quantité achetable maintenant (stock moins réservations en cours). */
  quantity: number;
  description: string;
  specs: [label: string, value: string][];
  views: number;
  favorites: number;
  /** URLs signées des photos, dans l'ordre d'affichage. Vide : on affiche le visuel de la catégorie. */
  images: string[];
  /** Échéance de visibilité (posée à la validation par la modération). */
  expiresAt?: string | null | undefined;
};

export type Seller = {
  id: string;
  name: string;
  campus: string;
  listings: number;
  sales: number;
  rating: number;
  reviews: number;
  verified: boolean;
  since: string;
  bio?: string | undefined;
  avatarUrl: string | null;
  followers?: number | undefined;
};

/* ---------- Dates ---------- */

/** « 14 oct. 2026 » : date lisible, sans l'heure. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  if (d < 30) return `il y a ${Math.floor(d / 7)} sem`;
  if (d < 365) return `il y a ${Math.floor(d / 30)} mois`;
  return `il y a ${Math.floor(d / 365)} an${d >= 730 ? "s" : ""}`;
}

export function memberSince(iso: string): string {
  return `Membre depuis ${new Date(iso).getFullYear()}`;
}

/** « 12 jours » / « 3 h » / « expirée » : temps restant avant une échéance. */
export function timeLeft(iso: string, now: number = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "expirée";
  const h = Math.floor(ms / 3_600_000);
  if (h < 24) return `${Math.max(h, 1)} h`;
  const d = Math.floor(h / 24);
  return `${d} jour${d > 1 ? "s" : ""}`;
}

/** Moyens de paiement Mobile Money proposés (CamPay : MTN et Orange, numéros camerounais). */
export const paymentMethods = [
  { id: "mtn", name: "MTN Mobile Money", hint: "Numéros 67x, 68x, 650–654", tone: "bg-warning/20 text-warning" },
  { id: "orange", name: "Orange Money", hint: "Numéros 69x, 655–659", tone: "bg-orange-500/15 text-orange-500" },
] as const;

export const CAMEROON = { code: "CM", name: "Cameroun", dial: "+237", mobileMoney: ["MTN MoMo", "Orange Money"] };
