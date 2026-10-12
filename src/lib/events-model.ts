import { Briefcase, CalendarDays, Football, Laptop, Music, Palette, type IconType } from "@/components/icons";

/* Événements : types d'affichage et aides pures (aucun accès réseau ici). */

export type EventStatus = "a-venir" | "complet" | "annule" | "termine";
export type ProgramItem = { time: string; title: string };
export type DbEventStatus = "draft" | "published" | "cancelled" | "completed";

export type EventItem = {
  id: string;
  name: string;
  category: string;
  categorySlug: string;
  tone: string;
  icon: IconType;
  startsAt: string;
  endsAt: string | null;
  dateLabel: string;
  place: string;
  campus: string;
  city: string;
  organizer: string;
  organizerSpaceId: string | null;
  createdBy: string;
  description: string;
  /** 0 = gratuit */
  price: number;
  capacity: number;
  taken: number;
  program: ProgramItem[];
  /** Statut affiché (déduit de la base et de l'heure). */
  status: EventStatus;
  dbStatus: DbEventStatus;
};

const categoryStyle: Record<string, { icon: IconType; tone: string }> = {
  technologie: { icon: Laptop, tone: "from-cyan-400/30 to-blue-900/30" },
  "vie-de-campus": { icon: Music, tone: "from-fuchsia-400/30 to-blue-900/30" },
  carriere: { icon: Briefcase, tone: "from-emerald-400/30 to-teal-900/30" },
  sport: { icon: Football, tone: "from-lime-400/30 to-emerald-900/30" },
  culture: { icon: Palette, tone: "from-violet-400/30 to-blue-900/30" },
};
export const styleOfEventCategory = (slug: string) => categoryStyle[slug] ?? { icon: CalendarDays, tone: "from-sky-300/30 to-blue-900/30" };

/** Fin effective : l'heure de fin, sinon début + 6 h (même règle que la base pour fermer la billetterie). */
export const eventEnd = (startsAt: string, endsAt: string | null) => (endsAt ? new Date(endsAt).getTime() : new Date(startsAt).getTime() + 6 * 3_600_000);

export function displayStatus(e: { dbStatus: DbEventStatus; startsAt: string; endsAt: string | null; capacity: number; taken: number }, now = Date.now()): EventStatus {
  if (e.dbStatus === "cancelled") return "annule";
  if (e.dbStatus === "completed" || eventEnd(e.startsAt, e.endsAt) <= now) return "termine";
  if (e.taken >= e.capacity) return "complet";
  return "a-venir";
}

/** « Sam. 26 sept. · 09:00 » */
export function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${time}`;
}

/** Places restantes, jamais négatif. */
export const remaining = (e: Pick<EventItem, "capacity" | "taken">) => Math.max(0, e.capacity - e.taken);

export type TicketStatus = "pending_payment" | "valid" | "used" | "cancelled" | "refunded";
export type MyTicket = { id: string; eventId: string; status: TicketStatus; code: string | null; expiresAt: string };

export type CheckResult = "valid" | "already_used" | "invalid_code" | "wrong_event" | "not_valid_status";
export const checkMessages: Record<CheckResult, { title: string; detail: string; tone: "success" | "warning" | "danger" }> = {
  valid: { title: "Billet valide", detail: "L'entrée est autorisée.", tone: "success" },
  already_used: { title: "Billet déjà contrôlé", detail: "Ce billet a déjà été utilisé à l'entrée.", tone: "warning" },
  invalid_code: { title: "Code inconnu", detail: "Aucun billet ne correspond à ce code.", tone: "danger" },
  wrong_event: { title: "Autre événement", detail: "Ce billet est valable pour un autre événement.", tone: "danger" },
  not_valid_status: { title: "Billet non valable", detail: "Ce billet est annulé, remboursé ou en attente de paiement.", tone: "danger" },
};
