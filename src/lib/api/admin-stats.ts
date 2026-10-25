import { useQuery } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";

/* Tableau de bord et statistiques du back-office : lecture seule, calculée par la base (migration 0020) à chaque ouverture.
 * Le volume Mobile Money n'est renvoyé qu'aux administrateurs et au responsable financier (null pour les autres rôles). */

export type DashboardStats = {
  users: number; universities: number; listings: number; events: number; openTickets: number; pendingReports: number;
  mobileMoneyVolume30d: number | null;
};

type StatsRow = {
  users: number | string; universities: number | string; listings: number | string; events: number | string;
  open_tickets: number | string; pending_reports: number | string; mobile_money_volume_30d: number | string | null;
};

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await requireSupabase().rpc("admin_dashboard_stats");
  if (error) throw error;
  const r = data as StatsRow;
  return {
    users: Number(r.users), universities: Number(r.universities), listings: Number(r.listings), events: Number(r.events),
    openTickets: Number(r.open_tickets), pendingReports: Number(r.pending_reports),
    mobileMoneyVolume30d: r.mobile_money_volume_30d === null ? null : Number(r.mobile_money_volume_30d),
  };
}

export type DayActivity = { day: string; signups: number; listings: number };

export async function fetchWeeklyActivity(): Promise<DayActivity[]> {
  const { data, error } = await requireSupabase().rpc("admin_weekly_activity");
  if (error) throw error;
  return ((data ?? []) as { day: string; signups: number | string; listings: number | string }[]).map((r) => ({
    day: new Date(`${r.day}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", ""),
    signups: Number(r.signups), listings: Number(r.listings),
  }));
}

export type MonthGrowth = { month: string; signups: number; cumulative: number };

export async function fetchSignupGrowth(months = 6): Promise<MonthGrowth[]> {
  const { data, error } = await requireSupabase().rpc("admin_signup_growth", { p_months: months });
  if (error) throw error;
  return ((data ?? []) as { month: string; signups: number | string; cumulative: number | string }[]).map((r) => ({
    month: new Date(`${r.month}T12:00:00`).toLocaleDateString("fr-FR", { month: "short" }).replace(".", ""),
    signups: Number(r.signups), cumulative: Number(r.cumulative),
  }));
}

export type CategoryCount = { slug: string; name: string; listings: number };

export async function fetchListingsByCategory(): Promise<CategoryCount[]> {
  const { data, error } = await requireSupabase().rpc("admin_listings_by_category");
  if (error) throw error;
  return ((data ?? []) as { slug: string; name: string; listings: number | string }[]).map((r) => ({ slug: r.slug, name: r.name, listings: Number(r.listings) }));
}

export type CampusCount = { campus: string; listings: number };

export async function fetchTopCampuses(limit = 8): Promise<CampusCount[]> {
  const { data, error } = await requireSupabase().rpc("admin_top_campuses", { p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as { campus: string | null; listings: number | string }[]).map((r) => ({ campus: r.campus ?? "Non renseigné", listings: Number(r.listings) }));
}

export type AdminAlert = { id: string; tone: "danger" | "warning" | "info"; title: string; description: string; detectedAt: string };

export async function fetchAlerts(): Promise<AdminAlert[]> {
  const { data, error } = await requireSupabase().rpc("admin_alerts");
  if (error) throw error;
  return ((data ?? []) as { id: string; tone: AdminAlert["tone"]; title: string; description: string; detected_at: string }[])
    .map((r) => ({ id: r.id, tone: r.tone, title: r.title, description: r.description, detectedAt: r.detected_at }));
}

const enabled = () => getSupabase() !== null;
const opts = { enabled: enabled(), staleTime: 30_000 } as const;

export const useDashboardStats = () => useQuery({ queryKey: ["admin-stats", "dashboard"], queryFn: fetchDashboardStats, ...opts, refetchInterval: 60_000 });
export const useWeeklyActivity = () => useQuery({ queryKey: ["admin-stats", "weekly"], queryFn: fetchWeeklyActivity, ...opts });
export const useSignupGrowth = () => useQuery({ queryKey: ["admin-stats", "growth"], queryFn: () => fetchSignupGrowth(6), ...opts });
export const useListingsByCategory = () => useQuery({ queryKey: ["admin-stats", "categories"], queryFn: fetchListingsByCategory, ...opts });
export const useTopCampuses = () => useQuery({ queryKey: ["admin-stats", "campuses"], queryFn: () => fetchTopCampuses(8), ...opts });
export const useAdminAlerts = () => useQuery({ queryKey: ["admin-stats", "alerts"], queryFn: fetchAlerts, ...opts, refetchInterval: 60_000 });
