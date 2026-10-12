import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  AlertCircle, BadgeCheck, Block, Check, CheckCircle, Clock, Hourglass, MapPin, Star, X, type IconType,
} from "@/components/icons";
import type { Stock } from "@/lib/mock-data";

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

/** Classes partagées par les badges, pastilles et alertes teintées. */
export const toneStyles: Record<Tone, string> = {
  neutral: "border-border bg-secondary text-secondary-foreground",
  primary: "border-primary/25 bg-primary/10 text-primary",
  success: "border-success/30 bg-success/15 text-[oklch(0.42_0.13_155)] dark:text-success",
  warning: "border-warning/40 bg-warning/20 text-[oklch(0.42_0.1_65)] dark:text-warning",
  danger: "border-destructive/30 bg-destructive/12 text-destructive",
  info: "border-info/30 bg-info/12 text-info",
};

export const toneSolidIcon: Record<Tone, string> = {
  neutral: "bg-secondary text-muted-foreground",
  primary: "bg-primary/12 text-primary",
  success: "bg-success/15 text-[oklch(0.42_0.13_155)] dark:text-success",
  warning: "bg-warning/20 text-[oklch(0.42_0.1_65)] dark:text-warning",
  danger: "bg-destructive/12 text-destructive",
  info: "bg-info/12 text-info",
};

export function Pill({ tone = "neutral", icon: Icon, children, className }: { tone?: Tone; icon?: IconType | undefined; children: ReactNode; className?: string | undefined }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4", toneStyles[tone], className)}>
      {Icon && <Icon className="size-3.5" />}
      {children}
    </span>
  );
}

/* ---------- Statuts métier (annonces, commandes, tickets, modération…) ---------- */
export const statusMap = {
  available: { label: "Disponible", tone: "success", icon: CheckCircle },
  reserved: { label: "Réservé", tone: "warning", icon: Clock },
  sold: { label: "Vendu", tone: "neutral", icon: Check },
  expired: { label: "Expiré", tone: "neutral", icon: Hourglass },
  unavailable: { label: "Indisponible", tone: "danger", icon: Block },
  pending: { label: "En attente", tone: "warning", icon: Hourglass },
  confirmed: { label: "Confirmé", tone: "success", icon: CheckCircle },
  failed: { label: "Échoué", tone: "danger", icon: X },
  cancelled: { label: "Annulé", tone: "neutral", icon: X },
  approved: { label: "Approuvé", tone: "success", icon: CheckCircle },
  rejected: { label: "Refusé", tone: "danger", icon: X },
  suspended: { label: "Suspendu", tone: "warning", icon: AlertCircle },
  banned: { label: "Banni", tone: "danger", icon: Block },
  open: { label: "Ouvert", tone: "info", icon: AlertCircle },
  inProgress: { label: "En cours", tone: "primary", icon: Clock },
  resolved: { label: "Résolu", tone: "success", icon: CheckCircle },
  closed: { label: "Fermé", tone: "neutral", icon: Check },
} as const satisfies Record<string, { label: string; tone: Tone; icon: IconType }>;

export type StatusKey = keyof typeof statusMap;

export function StatusBadge({ status, className }: { status: StatusKey; className?: string | undefined }) {
  const { label, tone, icon } = statusMap[status];
  return <Pill tone={tone} icon={icon} className={className}>{label}</Pill>;
}

/* ---------- Badges du design system ---------- */
export function VerificationBadge({ verified = true, compact = false }: { verified?: boolean; compact?: boolean }) {
  if (!verified) return <Pill tone="neutral" icon={AlertCircle}>{compact ? "Non vérifié" : "Compte non vérifié"}</Pill>;
  return <Pill tone="primary" icon={BadgeCheck}>{compact ? "Vérifié" : "Étudiant vérifié"}</Pill>;
}

export function LocationBadge({ campus, city, className }: { campus: string; city?: string | undefined; className?: string | undefined }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <MapPin className="size-3.5 shrink-0 text-primary" />
      <span className="truncate">{campus}{city ? ` · ${city}` : ""}</span>
    </span>
  );
}

export function ConditionBadge({ condition }: { condition: string }) {
  return (
    <span className="rounded-full bg-background/85 px-2 py-1 text-[10px] font-semibold text-foreground backdrop-blur">
      {condition}
    </span>
  );
}

const stockMap: Record<Stock, { label: string; dot: string }> = {
  available: { label: "En stock", dot: "bg-success" },
  low: { label: "Presque épuisé", dot: "bg-warning" },
  reserved: { label: "Réservé", dot: "bg-warning" },
  sold: { label: "Vendu", dot: "bg-muted-foreground" },
  expired: { label: "Expiré", dot: "bg-muted-foreground" },
};

export function StockIndicator({ stock, className }: { stock: Stock; className?: string | undefined }) {
  const { label, dot } = stockMap[stock];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground", className)}>
      <span className={cn("size-2 rounded-full", dot)} />
      {label}
    </span>
  );
}

export function RatingStars({ value, reviews, size = "sm" }: { value: number; reviews?: number | undefined; size?: "sm" | "md" }) {
  const dim = size === "md" ? "size-4" : "size-3.5";
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="inline-flex" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} pack={value >= n - 0.25 ? "filled" : "basic"} className={cn(dim, value >= n - 0.25 ? "text-warning" : "text-muted-foreground/50")} />
        ))}
      </span>
      <span className="font-semibold">{value.toFixed(1)}</span>
      {reviews !== undefined && <span className="text-muted-foreground">({reviews})</span>}
      <span className="sr-only">Note de {value} sur 5</span>
    </span>
  );
}
