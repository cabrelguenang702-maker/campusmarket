import { useQuery } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { UserFacingError } from "./errors";

/* Boutique Premium (migration 0067) : formules (seller_plans, lisibles quand elles sont actives), état de mon abonnement
 * (my_seller_subscription) et badge public (premium_seller_ids). Le prix vient toujours de la base ; le paiement passe par
 * subscription-checkout-initiate via usePaymentProcess (kind « subscription »). */

export type SellerPlan = { id: string; label: string; days: number; price: number };
export type MySubscription = {
  isPremium: boolean;
  current: { id: string; planLabel: string; startsAt: string; endsAt: string } | null;
  pending: { id: string; planLabel: string; amount: number } | null;
  history: { planLabel: string; amount: number; status: string; startsAt: string | null; endsAt: string | null; paidAt: string | null }[];
};

export async function fetchSellerPlans(): Promise<SellerPlan[]> {
  const { data, error } = await requireSupabase().from("seller_plans").select("id, label, days, price").eq("active", true).order("sort_order", { ascending: true }).order("days", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as { id: string; label: string; days: number; price: number }[]).map((p) => ({ id: p.id, label: p.label, days: Number(p.days), price: Number(p.price) }));
}

type Raw = {
  success?: boolean; error?: string; is_premium?: boolean;
  current?: { id: string; plan_label: string; starts_at: string; ends_at: string } | null;
  pending?: { id: string; plan_label: string; amount: number } | null;
  history?: { plan_label: string; amount: number; status: string; starts_at: string | null; ends_at: string | null; paid_at: string | null }[];
};

export async function fetchMySubscription(): Promise<MySubscription> {
  const { data, error } = await requireSupabase().rpc("my_seller_subscription");
  if (error) throw error;
  const r = data as Raw | null;
  if (!r?.success) throw new UserFacingError("Votre abonnement n'est pas accessible avec votre compte actuel.");
  return {
    isPremium: r.is_premium === true,
    current: r.current ? { id: r.current.id, planLabel: r.current.plan_label, startsAt: r.current.starts_at, endsAt: r.current.ends_at } : null,
    pending: r.pending ? { id: r.pending.id, planLabel: r.pending.plan_label, amount: Number(r.pending.amount) } : null,
    history: (r.history ?? []).map((h) => ({ planLabel: h.plan_label, amount: Number(h.amount), status: h.status, startsAt: h.starts_at, endsAt: h.ends_at, paidAt: h.paid_at })),
  };
}

const enabled = () => getSupabase() !== null;
export const useSellerPlans = () => useQuery({ queryKey: ["premium", "plans"], queryFn: fetchSellerPlans, enabled: enabled(), staleTime: 60_000 });
export const useMySubscription = (userId: string | undefined) => useQuery({ queryKey: ["premium", "mine", userId], queryFn: fetchMySubscription, enabled: enabled() && !!userId, staleTime: 15_000 });

/** Vrai si ce vendeur a un abonnement Premium en cours (badge public sur sa boutique). */
export async function fetchIsPremiumSeller(sellerId: string): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc("premium_seller_ids", { p_ids: [sellerId] });
  if (error) throw error;
  return Array.isArray(data) && (data as string[]).includes(sellerId);
}
export const useIsPremiumSeller = (sellerId: string | undefined) =>
  useQuery({ queryKey: ["premium", "badge", sellerId], queryFn: () => fetchIsPremiumSeller(sellerId!), enabled: enabled() && !!sellerId, staleTime: 5 * 60_000 });

export const STATUS_LABEL: Record<string, string> = { active: "Actif", expired: "Terminé", cancelled: "Annulé", refunded: "Remboursé" };
export const durationLabel = (days: number) => (days % 365 === 0 ? `${days / 365} an${days / 365 > 1 ? "s" : ""}` : days % 30 === 0 ? `${days / 30} mois` : `${days} jours`);
