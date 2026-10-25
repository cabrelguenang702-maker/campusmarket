import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { UserFacingError } from "./errors";

/* « Mes gains » (migration 0066) : soldes du créateur, compte Mobile Money de versement, versements reçus et dernières écritures.
 * Tout vient de la fonction my_earnings (la base calcule les soldes) ; le compte s'enregistre via save_payout_account.
 * Les versements sont enregistrés à la main par l'équipe finance : l'écran n'envoie jamais d'argent. */

export type PayoutProvider = "mtn_momo" | "orange_money";
export const PROVIDER_LABEL: Record<PayoutProvider, string> = { mtn_momo: "MTN Mobile Money", orange_money: "Orange Money" };

export type EarningKind = "order_seller_commission" | "course_commission" | "event_commission" | "tutoring_commission" | "seller_subscription" | "sponsorship" | "order_buyer_fee" | "group_unblock_fee" | "registration_fee";
export const KIND_LABEL: Record<string, string> = {
  order_seller_commission: "Vente d'article", course_commission: "Formation", event_commission: "Événement", tutoring_commission: "Séance de tutorat",
};

export type PayoutAccount = { provider: PayoutProvider; phone: string; holderName: string };
export type Earnings = {
  currency: string;
  available: number; pending: number; paid: number;
  account: PayoutAccount | null;
  payouts: { id: string; amount: number; reference: string | null; createdAt: string }[];
  entries: { kind: string; base: number; commission: number; net: number; availableAt: string | null; isReversal: boolean; createdAt: string }[];
};

type Raw = {
  success?: boolean; error?: string; currency?: string;
  balance?: { available?: number; pending?: number; paid?: number };
  account?: { provider: PayoutProvider; phone: string; holder_name: string } | null;
  payouts?: { id: string; amount: number; reference: string | null; created_at: string }[];
  earnings?: { kind: string; base_amount: number | null; commission: number | null; net: number | null; available_at: string | null; is_reversal: boolean; created_at: string }[];
};

export async function fetchEarnings(): Promise<Earnings> {
  const { data, error } = await requireSupabase().rpc("my_earnings");
  if (error) throw error;
  const r = data as Raw | null;
  if (!r?.success) throw new UserFacingError(r?.error === "forbidden" ? "Vos gains ne sont pas accessibles avec votre compte actuel (compte inactif ou double authentification à valider)." : "Chargement impossible. Réessayez dans un instant.");
  return {
    currency: r.currency ?? "XAF",
    available: Number(r.balance?.available ?? 0), pending: Number(r.balance?.pending ?? 0), paid: Number(r.balance?.paid ?? 0),
    account: r.account ? { provider: r.account.provider, phone: r.account.phone, holderName: r.account.holder_name } : null,
    payouts: (r.payouts ?? []).map((p) => ({ id: p.id, amount: Number(p.amount), reference: p.reference, createdAt: p.created_at })),
    entries: (r.earnings ?? []).map((e) => ({ kind: e.kind, base: Number(e.base_amount ?? 0), commission: Number(e.commission ?? 0), net: Number(e.net ?? 0), availableAt: e.available_at, isReversal: e.is_reversal, createdAt: e.created_at })),
  };
}

export const useEarnings = (userId: string | undefined) =>
  useQuery({ queryKey: ["earnings", userId], queryFn: fetchEarnings, enabled: getSupabase() !== null && !!userId, staleTime: 30_000 });

const ERRORS: Record<string, string> = {
  forbidden: "Action non autorisée avec votre compte actuel.",
  invalid_provider: "Choisissez MTN Mobile Money ou Orange Money.",
  invalid_phone: "Numéro invalide. Utilisez le format international, par exemple +237 6XX XXX XXX.",
  invalid_holder_name: "Le nom du titulaire doit faire entre 2 et 80 caractères.",
};

export function useSavePayoutAccount(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { provider: PayoutProvider; phone: string; holderName: string }) => {
      const { data, error } = await requireSupabase().rpc("save_payout_account", { p_provider: v.provider, p_phone: v.phone, p_holder_name: v.holderName });
      if (error) throw error;
      const r = data as { success?: boolean; error?: string } | null;
      if (!r?.success) throw new UserFacingError(ERRORS[r?.error ?? ""] ?? "Enregistrement impossible. Réessayez dans un instant.");
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["earnings", userId] }); },
  });
}

/** Masque le milieu du numéro pour l'affichage : +237 6•• ••• 123. */
export function maskPhone(phone: string): string {
  return phone.length <= 6 ? phone : `${phone.slice(0, 4)}${"•".repeat(Math.max(0, phone.length - 7))}${phone.slice(-3)}`;
}
