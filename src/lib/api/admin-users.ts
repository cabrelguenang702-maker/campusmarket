import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { UserFacingError, friendlyError } from "./errors";

/* Comptes et vérifications côté personnel. Les droits sont tenus par la base (migration 0020) : lister = personnel, suspendre =
 * personnel, bannir / lever un bannissement / vérifier à la main = administrateur avec session sécurisée (double
 * authentification), et personne ne peut agir sur un compte de rang égal ou supérieur ni sur le sien. */

export type AdminUserStatus = "active" | "suspended" | "banned";
export const userStatusLabel: Record<AdminUserStatus, string> = { active: "Actif", suspended: "Suspendu", banned: "Banni" };

export type AdminUser = {
  id: string; name: string; email: string; campus: string; status: AdminUserStatus; verified: boolean;
  joinedAt: string; listingsCount: number; reportsCount: number;
};
export type Page<T> = { rows: T[]; total: number };

export const USERS_PAGE_SIZE = 25;

type UserRow = {
  id: string; full_name: string | null; email: string | null; campus: string | null; account_status: AdminUserStatus; verified: boolean;
  joined_at: string; listings_count: number | string; reports_count: number | string; total_count: number | string;
};

export async function fetchAdminUsers(input: { search: string; status: AdminUserStatus | undefined; page: number }): Promise<Page<AdminUser>> {
  const { data, error } = await requireSupabase().rpc("admin_list_users", {
    p_search: input.search.trim() || null, p_status: input.status ?? null, p_limit: USERS_PAGE_SIZE, p_offset: input.page * USERS_PAGE_SIZE,
  });
  if (error) throw error;
  const rows = (data ?? []) as UserRow[];
  return {
    total: rows.length > 0 ? Number(rows[0]!.total_count) : 0,
    rows: rows.map((r) => ({
      id: r.id, name: r.full_name?.trim() || "Étudiant", email: r.email ?? "", campus: r.campus ?? "—", status: r.account_status, verified: r.verified,
      joinedAt: r.joined_at, listingsCount: Number(r.listings_count), reportsCount: Number(r.reports_count),
    })),
  };
}

export type VerificationRequest = { id: string; userId: string; name: string; documentType: "student_card" | "other_document"; paths: string[]; createdAt: string };
export const documentLabel: Record<VerificationRequest["documentType"], string> = { student_card: "Carte d'étudiant", other_document: "Autre document" };

type VerifRow = { id: string; user_id: string; full_name: string | null; document_type: VerificationRequest["documentType"]; document_paths: string[]; created_at: string; total_count: number | string };

export async function fetchPendingVerifications(page: number): Promise<Page<VerificationRequest>> {
  const { data, error } = await requireSupabase().rpc("admin_list_verifications", { p_status: "pending", p_limit: USERS_PAGE_SIZE, p_offset: page * USERS_PAGE_SIZE });
  if (error) throw error;
  const rows = (data ?? []) as VerifRow[];
  return {
    total: rows.length > 0 ? Number(rows[0]!.total_count) : 0,
    rows: rows.map((r) => ({ id: r.id, userId: r.user_id, name: r.full_name?.trim() || "Étudiant", documentType: r.document_type, paths: r.document_paths, createdAt: r.created_at })),
  };
}

/** Lien temporaire (10 min) vers un justificatif : le dossier est privé, seul le personnel peut le lire. */
export async function signedDocumentUrl(path: string): Promise<string> {
  const { data, error } = await requireSupabase().storage.from("verification-documents").createSignedUrl(path, 600);
  if (error || !data?.signedUrl) throw new UserFacingError("Document introuvable ou accès refusé.");
  return data.signedUrl;
}

const ERRORS: Record<string, string> = {
  forbidden: "Cette action est réservée à un rôle supérieur au vôtre.",
  cannot_target_self: "Vous ne pouvez pas agir sur votre propre compte.",
  not_found: "Ce compte n'existe plus.",
  insufficient_rank: "Vous ne pouvez pas agir sur un compte de rang égal ou supérieur au vôtre.",
  reason_required: "Indiquez un motif d'au moins 3 caractères.",
  already_banned: "Ce compte est déjà banni.",
  not_restricted: "Ce compte n'est pas suspendu.",
  mfa_required: "Cette action exige une session sécurisée : validez votre code de double authentification (page Sécurité).",
  cannot_review_own: "Vous ne pouvez pas examiner votre propre demande.",
  already_reviewed: "Cette demande a déjà été traitée.",
};

async function callAdmin(fn: string, args: Record<string, unknown>): Promise<void> {
  const { data, error } = await requireSupabase().rpc(fn, args);
  if (error) throw error;
  const r = data as { success?: boolean; error?: string } | null;
  if (!r?.success) throw new UserFacingError(ERRORS[r?.error ?? ""] ?? "Action impossible.");
}

const enabled = () => getSupabase() !== null;

export function useAdminUsers(input: { search: string; status: AdminUserStatus | undefined; page: number }) {
  return useQuery({ queryKey: ["admin-users", "list", input], queryFn: () => fetchAdminUsers(input), enabled: enabled(), placeholderData: keepPreviousData, staleTime: 10_000 });
}
export function usePendingVerifications(page: number) {
  return useQuery({ queryKey: ["admin-users", "verifications", page], queryFn: () => fetchPendingVerifications(page), enabled: enabled(), placeholderData: keepPreviousData, staleTime: 10_000 });
}

export function useAdminUserActions() {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["admin-users"] }); };
  const suspend = useMutation({ mutationFn: (v: { userId: string; reason: string }) => callAdmin("admin_suspend_user", { p_user_id: v.userId, p_reason: v.reason }), onSettled: refresh });
  const ban = useMutation({ mutationFn: (v: { userId: string; reason: string }) => callAdmin("admin_ban_user", { p_user_id: v.userId, p_reason: v.reason }), onSettled: refresh });
  const reactivate = useMutation({ mutationFn: (v: { userId: string }) => callAdmin("admin_reactivate_user", { p_user_id: v.userId }), onSettled: refresh });
  const verify = useMutation({ mutationFn: (v: { userId: string }) => callAdmin("admin_verify_user", { p_user_id: v.userId, p_verified: true }), onSettled: refresh });
  const review = useMutation({
    mutationFn: (v: { requestId: string; approve: boolean; reason?: string }) => callAdmin("admin_review_verification", { p_request_id: v.requestId, p_approve: v.approve, p_reason: v.reason ?? null }),
    onSettled: refresh,
  });
  return { suspend, ban, reactivate, verify, review, errorText: (e: unknown, fallback = "Action impossible.") => friendlyError(e, fallback) };
}
