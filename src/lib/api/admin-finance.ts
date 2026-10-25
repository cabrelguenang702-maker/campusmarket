import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { UserFacingError, friendlyError } from "./errors";

/* Finances du back-office (migrations 0064 à 0070) : revenus de la plateforme, frais et commissions, interrupteurs, tarifs d'inscription,
 * formules Boutique Premium, versements aux créateurs et remboursements de tutorat.
 * Lecture : administrateurs et responsable financier. Écriture des réglages : administrateurs. Toute écriture exige une session sécurisée (aal2).
 * Les montants sont en FCFA (XAF) ; les dates des périodes sont en UTC, comme dans la base. */

export type FeeKind = "order_buyer_fee" | "order_seller_commission" | "course_commission" | "event_commission" | "tutoring_commission" | "group_unblock_fee";
export type RevenueKind = FeeKind | "sponsorship" | "seller_subscription" | "registration_fee";
export type FlagKey = "paid_tutoring" | "paid_registration";

export const FEE_KINDS: FeeKind[] = ["order_buyer_fee", "order_seller_commission", "course_commission", "event_commission", "tutoring_commission", "group_unblock_fee"];

export const REVENUE_LABEL: Record<RevenueKind, string> = {
  order_buyer_fee: "Frais de service (acheteurs)",
  order_seller_commission: "Commission sur les ventes",
  course_commission: "Commission sur les formations",
  event_commission: "Commission sur les billets",
  tutoring_commission: "Commission sur le tutorat",
  group_unblock_fee: "Déblocage d'achat groupé",
  sponsorship: "Mises en avant d'annonces",
  seller_subscription: "Abonnements Boutique Premium",
  registration_fee: "Frais d'inscription",
};

export const FEE_INFO: Record<FeeKind, { label: string; hint: string; fixedOnly: boolean }> = {
  order_buyer_fee: { label: "Frais de service acheteur", hint: "Ajoutés au prix payé par l'acheteur à chaque commande.", fixedOnly: false },
  order_seller_commission: { label: "Commission vendeur", hint: "Retenue sur la part du vendeur. Les vendeurs Premium en sont exemptés.", fixedOnly: false },
  course_commission: { label: "Commission formations", hint: "Retenue sur la part du formateur pour chaque inscription payante.", fixedOnly: false },
  event_commission: { label: "Commission billets", hint: "Retenue sur la part de l'organisateur pour chaque billet payant.", fixedOnly: false },
  tutoring_commission: { label: "Commission tutorat", hint: "Retenue sur la part du tuteur (séances payantes uniquement).", fixedOnly: false },
  group_unblock_fee: { label: "Déblocage d'achat groupé", hint: "Montant fixe payé par l'étudiant bloqué pour rejoindre à nouveau un achat groupé.", fixedOnly: true },
};

export const FLAG_INFO: Record<FlagKey, { label: string; hint: string }> = {
  paid_tutoring: { label: "Tutorat payant", hint: "Autorise les tuteurs à fixer un prix horaire. Désactivé : toutes les séances sont gratuites." },
  paid_registration: { label: "Inscription payante", hint: "Les nouveaux comptes des pays qui ont un tarif actif doivent payer avant d'accéder à la plateforme. Désactiver libère les comptes en attente." },
};

export type FeeSetting = { kind: FeeKind; percent: number; fixed: number; holdDays: number; updatedAt: string; updatedBy: string | null };
export type FeeSettingsData = { settings: FeeSetting[]; flags: Record<FlagKey, boolean> };

export type ByKind = { kind: RevenueKind; transactions: number; volume: number; revenue: number };
export type DailyRevenue = { day: string; label: string; revenue: number };
export type RevenueSummary = {
  from: string; to: string; netRevenue: number; refunded: number; transactions: number; volume: number;
  previousNet: number; processedVolume: number; byKind: ByKind[]; creatorNet: Partial<Record<RevenueKind, number>>; daily: DailyRevenue[];
};
export type RevenueEntry = {
  id: string; kind: RevenueKind; amount: number; baseAmount: number; ratePercent: number | null; creatorName: string | null;
  creatorNet: number | null; availableAt: string | null; isReversal: boolean; createdAt: string;
};
export type CreatorBalance = {
  creatorId: string; name: string; available: number; pending: number; paid: number;
  provider: string | null; phone: string | null; holderName: string | null; hasAccount: boolean;
};
export type BalancesData = { totals: { available: number; pending: number; paid: number; creatorsDue: number }; creators: CreatorBalance[] };
export type Payout = {
  id: string; creatorId: string; creatorName: string; amount: number; provider: string | null; phone: string | null; holderName: string | null;
  reference: string | null; note: string | null; createdAt: string; voidedAt: string | null; voidReason: string | null;
};
export type TutoringRefund = {
  id: string; amount: number; subject: string; status: string; scheduledAt: string | null; paidAt: string | null;
  studentName: string; tutorName: string;
};
export type RegistrationCountry = { code: string; name: string; price: number | null; active: boolean };
export type SellerPlan = { id: string; label: string; days: number; price: number; active: boolean; sortOrder: number };

const ERRORS: Record<string, string> = {
  forbidden: "Action réservée aux administrateurs (ou au responsable financier pour la consultation), avec une session sécurisée : validez votre code de double authentification dans Sécurité.",
  invalid_period: "Période invalide.", invalid_kind: "Type invalide.", invalid_key: "Interrupteur inconnu.", invalid_value: "Valeur invalide.",
  invalid_percent: "Pourcentage invalide (de 0 à 30 %, et 0 pour un montant fixe).", invalid_fixed: "Montant fixe invalide (de 0 à 50 000 FCFA).",
  invalid_hold_days: "Délai invalide (de 0 à 60 jours).", invalid_amount: "Montant invalide.", invalid_text: "Référence ou note trop longue.",
  no_payout_account: "Cette personne n'a pas encore enregistré de compte de versement.", exceeds_available: "Le montant dépasse le solde disponible.",
  reason_required: "Indiquez un motif (3 caractères minimum).", already_voided: "Ce versement est déjà annulé.", not_found: "Élément introuvable.",
  no_refund_due: "Aucun remboursement n'est dû pour cette séance.", invalid_price: "Prix invalide.", invalid_label: "Nom invalide (2 à 40 caractères).",
  invalid_days: "Durée invalide (7 à 366 jours).", invalid_country: "Pays inconnu.", invalid_status: "Statut invalide.",
};

type Envelope = { success?: boolean; error?: string };
async function rpc<T extends Envelope>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().rpc(fn, args);
  if (error) throw error;
  const r = data as T | null;
  if (!r?.success) throw new UserFacingError(ERRORS[r?.error ?? ""] ?? "Action impossible.");
  return r;
}

const num = (v: unknown) => Number(v ?? 0);
const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }).replace(".", "");

/** Date AAAA-MM-JJ en UTC (la base calcule les périodes en UTC). */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export function periodOf(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: isoDay(from), to: isoDay(to) };
}

/* ------------------------------ Revenus ------------------------------ */

type SummaryRaw = Envelope & {
  from: string; to: string;
  totals: { net_revenue: number; refunded: number; transactions: number; volume: number };
  previous_period_net: number; processed_volume: number;
  by_kind: { kind: RevenueKind; transactions: number; volume: number; revenue: number }[];
  creator_net_total: Partial<Record<RevenueKind, number>>;
  daily: { day: string; revenue: number }[];
};

export async function fetchRevenueSummary(from: string, to: string): Promise<RevenueSummary> {
  const r = await rpc<SummaryRaw>("admin_revenue_summary", { p_from: from, p_to: to });
  return {
    from: r.from, to: r.to, netRevenue: num(r.totals.net_revenue), refunded: num(r.totals.refunded), transactions: num(r.totals.transactions),
    volume: num(r.totals.volume), previousNet: num(r.previous_period_net), processedVolume: num(r.processed_volume),
    byKind: (r.by_kind ?? []).map((k) => ({ kind: k.kind, transactions: num(k.transactions), volume: num(k.volume), revenue: num(k.revenue) })),
    creatorNet: r.creator_net_total ?? {},
    daily: (r.daily ?? []).map((d) => ({ day: d.day, label: dayLabel(d.day), revenue: num(d.revenue) })),
  };
}

type EntryRaw = {
  id: string; kind: RevenueKind; amount: number; base_amount: number; rate_percent: number | null; creator_name: string | null;
  creator_net: number | null; available_at: string | null; is_reversal: boolean; created_at: string;
};
export const ENTRIES_PAGE = 25;

export async function fetchRevenueEntries(p: { from: string; to: string; kind: RevenueKind | null; offset: number }): Promise<{ total: number; entries: RevenueEntry[] }> {
  const r = await rpc<Envelope & { total: number; entries: EntryRaw[] }>("admin_revenue_entries", {
    p_from: p.from, p_to: p.to, p_kind: p.kind, p_limit: ENTRIES_PAGE, p_offset: p.offset,
  });
  return {
    total: num(r.total),
    entries: (r.entries ?? []).map((e) => ({
      id: e.id, kind: e.kind, amount: num(e.amount), baseAmount: num(e.base_amount), ratePercent: e.rate_percent === null ? null : Number(e.rate_percent),
      creatorName: e.creator_name, creatorNet: e.creator_net === null ? null : num(e.creator_net), availableAt: e.available_at,
      isReversal: e.is_reversal, createdAt: e.created_at,
    })),
  };
}

/* ------------------------------ Réglages ------------------------------ */

type SettingsRaw = Envelope & {
  settings: { kind: FeeKind; fee_percent: number | string; fee_fixed: number; payout_hold_days: number; updated_at: string; updated_by_name: string | null }[];
  flags: Partial<Record<FlagKey, boolean>>;
};

export async function fetchFeeSettings(): Promise<FeeSettingsData> {
  const r = await rpc<SettingsRaw>("admin_get_fee_settings");
  return {
    settings: (r.settings ?? []).map((s) => ({ kind: s.kind, percent: Number(s.fee_percent), fixed: num(s.fee_fixed), holdDays: num(s.payout_hold_days), updatedAt: s.updated_at, updatedBy: s.updated_by_name })),
    flags: { paid_tutoring: r.flags?.paid_tutoring === true, paid_registration: r.flags?.paid_registration === true },
  };
}

export async function fetchRegistrationFees(): Promise<RegistrationCountry[]> {
  const r = await rpc<Envelope & { countries: { code: string; name: string; price: number | null; active: boolean }[] }>("admin_list_registration_fees");
  return (r.countries ?? []).map((c) => ({ code: c.code, name: c.name, price: c.price === null ? null : num(c.price), active: c.active === true }));
}

export async function fetchSellerPlans(): Promise<SellerPlan[]> {
  const { data, error } = await requireSupabase().from("seller_plans").select("id, label, days, price, active, sort_order").order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((p) => ({ id: p.id as string, label: p.label as string, days: num(p.days), price: num(p.price), active: p.active === true, sortOrder: num(p.sort_order) }));
}

/* ------------------------------ Versements ------------------------------ */

type BalancesRaw = Envelope & {
  totals: { available: number; pending: number; paid: number; creators_due: number };
  creators: { creator_id: string; creator_name: string | null; available: number; pending: number; paid: number; provider: string | null; phone: string | null; holder_name: string | null; has_account: boolean }[];
};

export async function fetchCreatorBalances(onlyDue: boolean): Promise<BalancesData> {
  const r = await rpc<BalancesRaw>("admin_creator_balances", { p_only_due: onlyDue, p_limit: 100, p_offset: 0 });
  return {
    totals: { available: num(r.totals.available), pending: num(r.totals.pending), paid: num(r.totals.paid), creatorsDue: num(r.totals.creators_due) },
    creators: (r.creators ?? []).map((c) => ({
      creatorId: c.creator_id, name: c.creator_name?.trim() || "Compte sans nom", available: num(c.available), pending: num(c.pending), paid: num(c.paid),
      provider: c.provider, phone: c.phone, holderName: c.holder_name, hasAccount: c.has_account === true,
    })),
  };
}

type PayoutRaw = {
  id: string; creator_id: string; creator_name: string | null; amount: number; provider: string | null; phone: string | null; holder_name: string | null;
  reference: string | null; note: string | null; created_at: string; voided_at: string | null; void_reason: string | null;
};
export const PAYOUTS_PAGE = 30;

export async function fetchPayouts(offset: number): Promise<{ total: number; payouts: Payout[] }> {
  const r = await rpc<Envelope & { total: number; payouts: PayoutRaw[] }>("admin_list_payouts", { p_creator: null, p_limit: PAYOUTS_PAGE, p_offset: offset });
  return {
    total: num(r.total),
    payouts: (r.payouts ?? []).map((p) => ({
      id: p.id, creatorId: p.creator_id, creatorName: p.creator_name?.trim() || "Compte sans nom", amount: num(p.amount), provider: p.provider, phone: p.phone,
      holderName: p.holder_name, reference: p.reference, note: p.note, createdAt: p.created_at, voidedAt: p.voided_at, voidReason: p.void_reason,
    })),
  };
}

/* ------------------------------ Remboursements de tutorat ------------------------------ */

export async function fetchTutoringRefunds(): Promise<TutoringRefund[]> {
  const r = await rpc<Envelope & { requests: { id: string; amount: number; subject: string; status: string; scheduled_at: string | null; paid_at: string | null; student_name: string | null; tutor_name: string | null }[] }>(
    "admin_list_tutoring_refunds_due", { p_limit: 100, p_offset: 0 });
  return (r.requests ?? []).map((t) => ({
    id: t.id, amount: num(t.amount), subject: t.subject, status: t.status, scheduledAt: t.scheduled_at, paidAt: t.paid_at,
    studentName: t.student_name?.trim() || "Étudiant", tutorName: t.tutor_name?.trim() || "Tuteur",
  }));
}

/* ------------------------------ Hooks ------------------------------ */

const enabled = () => getSupabase() !== null;
const KEY = "admin-finance";

export const useRevenueSummary = (from: string, to: string) =>
  useQuery({ queryKey: [KEY, "summary", from, to], queryFn: () => fetchRevenueSummary(from, to), enabled: enabled(), staleTime: 30_000, placeholderData: keepPreviousData });
export const useRevenueEntries = (from: string, to: string, kind: RevenueKind | null, offset: number) =>
  useQuery({ queryKey: [KEY, "entries", from, to, kind, offset], queryFn: () => fetchRevenueEntries({ from, to, kind, offset }), enabled: enabled(), staleTime: 30_000, placeholderData: keepPreviousData });
export const useFeeSettings = () => useQuery({ queryKey: [KEY, "settings"], queryFn: fetchFeeSettings, enabled: enabled(), staleTime: 10_000 });
export const useRegistrationFees = () => useQuery({ queryKey: [KEY, "registration"], queryFn: fetchRegistrationFees, enabled: enabled(), staleTime: 10_000 });
export const useSellerPlans = () => useQuery({ queryKey: [KEY, "plans"], queryFn: fetchSellerPlans, enabled: enabled(), staleTime: 10_000 });
export const useCreatorBalances = (onlyDue: boolean) => useQuery({ queryKey: [KEY, "balances", onlyDue], queryFn: () => fetchCreatorBalances(onlyDue), enabled: enabled(), staleTime: 10_000 });
export const usePayouts = (offset: number) => useQuery({ queryKey: [KEY, "payouts", offset], queryFn: () => fetchPayouts(offset), enabled: enabled(), staleTime: 10_000, placeholderData: keepPreviousData });
export const useTutoringRefunds = () => useQuery({ queryKey: [KEY, "tutoring-refunds"], queryFn: fetchTutoringRefunds, enabled: enabled(), staleTime: 10_000 });

const nullIfEmpty = (s: string) => (s.trim() === "" ? null : s.trim());

export function useFinanceActions() {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: [KEY] }); };
  return {
    saveFee: useMutation({
      mutationFn: (v: { kind: FeeKind; percent: number; fixed: number; holdDays: number }) =>
        rpc("admin_save_fee_setting", { p_kind: v.kind, p_percent: v.percent, p_fixed: v.fixed, p_hold_days: v.holdDays }), onSettled: refresh,
    }),
    setFlag: useMutation({ mutationFn: (v: { key: FlagKey; enabled: boolean }) => rpc("admin_set_platform_flag", { p_key: v.key, p_enabled: v.enabled }), onSettled: refresh }),
    saveRegistrationFee: useMutation({
      mutationFn: (v: { country: string; price: number; active: boolean }) => rpc("admin_save_registration_fee", { p_country: v.country, p_price: v.price, p_active: v.active }), onSettled: refresh,
    }),
    savePlan: useMutation({
      mutationFn: (v: { id: string | null; label: string; days: number; price: number; active: boolean; sortOrder: number }) =>
        rpc("admin_save_seller_plan", { p_id: v.id, p_label: v.label, p_days: v.days, p_price: v.price, p_active: v.active, p_sort: v.sortOrder }), onSettled: refresh,
    }),
    recordPayout: useMutation({
      mutationFn: (v: { creatorId: string; amount: number; reference: string; note: string }) =>
        rpc("admin_record_payout", { p_creator: v.creatorId, p_amount: v.amount, p_reference: nullIfEmpty(v.reference), p_note: nullIfEmpty(v.note) }), onSettled: refresh,
    }),
    voidPayout: useMutation({ mutationFn: (v: { id: string; reason: string }) => rpc("admin_void_payout", { p_payout: v.id, p_reason: v.reason }), onSettled: refresh }),
    markTutoringRefunded: useMutation({ mutationFn: (id: string) => rpc("admin_mark_tutoring_refunded", { p_request: id }), onSettled: refresh }),
    errorText: (e: unknown, fallback = "Action impossible.") => friendlyError(e, fallback),
  };
}
