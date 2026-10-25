import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { UserFacingError, friendlyError } from "./errors";
import type { Page } from "./admin-users";

/* Modération des annonces et signalements côté personnel. Règles tenues par la base (migration 0020) : changer le statut d'une
 * annonce = modérateur ou administrateur, jamais sur sa propre annonce ; approuver ne se fait que depuis « en attente »,
 * rétablir une annonce retirée la remet « en attente » (jamais directement publiée) ; retirer ou mettre en attente exige un
 * motif ; traiter un signalement = personnel, jamais le sien ni un signalement contre soi. Tout est journalisé. */

export const LISTINGS_PAGE_SIZE = 25;

export type ModerationStatus = "pending_review" | "published" | "removed";
export const moderationLabel: Record<ModerationStatus, string> = { pending_review: "À valider", published: "Publiée", removed: "Retirée" };

export type AdminListing = {
  id: string; name: string; price: number; campus: string; category: string; status: ModerationStatus;
  sellerName: string; createdAt: string; moderationReason: string | null;
};

type Row = {
  id: string; name: string; price: number; campus: string | null; category_slug: string; status: ModerationStatus; created_at: string;
  moderation_reason: string | null; seller: { full_name: string | null } | null;
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function fetchAdminListings(input: { status: ModerationStatus; search: string; page: number }): Promise<Page<AdminListing>> {
  let query = requireSupabase()
    .from("products")
    .select("id, name, price, campus, category_slug, status, created_at, moderation_reason, seller:profiles!seller_id(full_name)", { count: "exact" })
    .eq("status", input.status).is("deleted_at", null);
  const term = input.search.trim().slice(0, 80);
  if (term) query = query.ilike("name", `%${escapeLike(term)}%`);
  const from = input.page * LISTINGS_PAGE_SIZE;
  const { data, error, count } = await query.order("created_at", { ascending: input.status === "pending_review" }).range(from, from + LISTINGS_PAGE_SIZE - 1);
  if (error) throw error;
  return {
    total: count ?? 0,
    rows: ((data ?? []) as unknown as Row[]).map((r) => ({
      id: r.id, name: r.name, price: r.price, campus: r.campus ?? "—", category: r.category_slug, status: r.status,
      sellerName: r.seller?.full_name?.trim() || "Vendeur", createdAt: r.created_at, moderationReason: r.moderation_reason,
    })),
  };
}

/** Nombre d'annonces qui attendent une validation (pastille de l'onglet). */
export async function fetchPendingListingsCount(): Promise<number> {
  const { count, error } = await requireSupabase().from("products").select("id", { count: "exact", head: true }).eq("status", "pending_review").is("deleted_at", null);
  if (error) throw error;
  return count ?? 0;
}

export type ReportStatus = "pending" | "reviewing" | "actioned" | "dismissed";
export type ReportTarget = "profile" | "product" | "message" | "comment" | "space" | "course";
export const reportStatusLabel: Record<ReportStatus, string> = { pending: "En attente", reviewing: "En cours", actioned: "Traité", dismissed: "Rejeté" };
export const reportTargetLabel: Record<ReportTarget, string> = { profile: "Profil", product: "Annonce", message: "Message", comment: "Commentaire", space: "Espace", course: "Cours" };

export type AdminReport = {
  id: string; targetType: ReportTarget; targetId: string; targetLabel: string; reason: string; details: string | null;
  reporterName: string; status: ReportStatus; handledBy: string | null; note: string | null; createdAt: string;
};
type ReportRow = {
  id: string; target_type: ReportTarget; target_id: string; target_label: string; reason: string; details: string | null; reporter_name: string | null;
  status: ReportStatus; handled_by_name: string | null; resolution_note: string | null; created_at: string; total_count: number | string;
};

export async function fetchReports(input: { open: boolean; page: number }): Promise<Page<AdminReport>> {
  // La base trie « à traiter » d'abord ; on filtre par statut côté client pour l'onglet des signalements clos.
  const { data, error } = await requireSupabase().rpc("admin_list_reports", { p_status: null, p_limit: 100, p_offset: 0 });
  if (error) throw error;
  const all = ((data ?? []) as ReportRow[]).map<AdminReport>((r) => ({
    id: r.id, targetType: r.target_type, targetId: r.target_id, targetLabel: r.target_label, reason: r.reason, details: r.details,
    reporterName: r.reporter_name?.trim() || "Étudiant", status: r.status, handledBy: r.handled_by_name, note: r.resolution_note, createdAt: r.created_at,
  }));
  const filtered = all.filter((r) => (input.open ? r.status === "pending" || r.status === "reviewing" : r.status === "actioned" || r.status === "dismissed"));
  const from = input.page * LISTINGS_PAGE_SIZE;
  return { total: filtered.length, rows: filtered.slice(from, from + LISTINGS_PAGE_SIZE) };
}

const ERRORS: Record<string, string> = {
  forbidden: "Cette action est réservée aux modérateurs et aux administrateurs.",
  not_found: "Cet élément n'existe plus.",
  conflict_of_interest: "Vous ne pouvez pas modérer votre propre contenu ni un signalement qui vous concerne.",
  listing_deleted: "Cette annonce a été supprimée par son vendeur.",
  invalid_transition: "Cette action n'est pas possible dans l'état actuel (la liste va se rafraîchir).",
  invalid_status: "Statut invalide.",
  reason_required: "Indiquez un motif d'au moins 3 caractères.",
  already_closed: "Ce signalement est déjà clos.",
  note_too_long: "La note est trop longue (1 000 caractères maximum).",
};

async function callAdmin(fn: string, args: Record<string, unknown>): Promise<void> {
  const { data, error } = await requireSupabase().rpc(fn, args);
  if (error) throw error;
  const r = data as { success?: boolean; error?: string } | null;
  if (!r?.success) throw new UserFacingError(ERRORS[r?.error ?? ""] ?? "Action impossible.");
}

const enabled = () => getSupabase() !== null;

export function useAdminListings(input: { status: ModerationStatus; search: string; page: number }) {
  return useQuery({ queryKey: ["admin-listings", "list", input], queryFn: () => fetchAdminListings(input), enabled: enabled(), placeholderData: keepPreviousData, staleTime: 10_000 });
}
export function usePendingListingsCount() {
  return useQuery({ queryKey: ["admin-listings", "pending-count"], queryFn: fetchPendingListingsCount, enabled: enabled(), staleTime: 15_000, refetchInterval: 30_000 });
}
export function useReports(input: { open: boolean; page: number }) {
  return useQuery({ queryKey: ["admin-listings", "reports", input], queryFn: () => fetchReports(input), enabled: enabled(), placeholderData: keepPreviousData, staleTime: 10_000 });
}

export function useModerationActions() {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["admin-listings"] }); void qc.invalidateQueries({ queryKey: ["products"] }); };
  const setStatus = useMutation({
    mutationFn: (v: { productId: string; status: ModerationStatus; reason?: string }) => callAdmin("admin_set_listing_status", { p_product_id: v.productId, p_status: v.status, p_reason: v.reason ?? null }),
    onSettled: refresh,
  });
  const handleReport = useMutation({
    mutationFn: (v: { reportId: string; status: "reviewing" | "actioned" | "dismissed"; note?: string }) => callAdmin("admin_handle_report", { p_report_id: v.reportId, p_status: v.status, p_note: v.note ?? null }),
    onSettled: refresh,
  });
  return { setStatus, handleReport, errorText: (e: unknown, fallback = "Action impossible.") => friendlyError(e, fallback) };
}
