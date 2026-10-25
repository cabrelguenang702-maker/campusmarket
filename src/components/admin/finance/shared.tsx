import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const skeleton = (
  <div aria-busy className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-foreground/10" />)}</div>
);

export const timeFmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const dayFmt = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });

export const providerLabel = (p: string | null) => (p === "mtn_momo" ? "MTN Mobile Money" : p === "orange_money" ? "Orange Money" : "Compte non renseigné");

/** Entier positif saisi (espaces tolérés) ; null si invalide. */
export function parseInteger(s: string): number | null {
  const t = s.replace(/\s/g, "");
  return /^\d{1,9}$/.test(t) ? Number(t) : null;
}

/** Pourcentage saisi (virgule ou point, 2 décimales maximum) ; null si invalide. */
export function parsePercent(s: string): number | null {
  const t = s.trim().replace(",", ".");
  return /^\d{1,2}(\.\d{1,2})?$/.test(t) ? Number(t) : null;
}

export function Stat({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "warn" }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-display text-2xl font-bold leading-tight", tone === "good" && "text-primary", tone === "warn" && "text-destructive")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Une cellule CSV : guillemets doublés, et une valeur qui commencerait par = + - @ est neutralisée pour qu'Excel ne l'exécute pas comme une formule. */
export const csvCell = (v: string | number) => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export function downloadCsv(filename: string, lines: string[]) {
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
