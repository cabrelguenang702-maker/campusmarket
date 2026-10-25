import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { UserFacingError, friendlyError } from "./errors";

/* Équipe, invitations et journal d'audit (migrations 0011 et 0020). Tout est réservé aux administrateurs ; donner ou retirer un rôle
 * d'administrateur demande un super-administrateur ; toute écriture exige une session sécurisée (double authentification). */

export type StaffRole = "super_admin" | "admin" | "moderator" | "support" | "financial_manager";
export const ROLE_LABEL: Record<StaffRole, string> = {
  super_admin: "Super administrateur", admin: "Administrateur", moderator: "Modérateur", support: "Support", financial_manager: "Responsable financier",
};
export const ROLE_DESCRIPTION: Record<StaffRole, string> = {
  super_admin: "Accès complet, y compris la nomination des administrateurs.",
  admin: "Équipe, universités, géographie, utilisateurs, annonces, support.",
  moderator: "Annonces, signalements et comptes.",
  support: "Tickets d'aide et signalements.",
  financial_manager: "Suivi financier.",
};
/** Rôles qu'on peut proposer à une invitation. « super_admin » ne s'attribue jamais par invitation. */
export const INVITABLE_ROLES: StaffRole[] = ["moderator", "support", "financial_manager", "admin"];
const RANK: Record<StaffRole, number> = { super_admin: 4, admin: 3, moderator: 2, support: 2, financial_manager: 2 };
export const topRole = (roles: StaffRole[]): StaffRole => [...roles].sort((a, b) => RANK[b] - RANK[a])[0] ?? "support";

export type TeamMember = { userId: string; name: string; email: string; roles: StaffRole[]; since: string };
export type InvitationState = "pending" | "accepted" | "revoked" | "expired";
export type Invitation = { id: string; email: string; role: StaffRole; invitedBy: string; state: InvitationState; expiresAt: string; createdAt: string };
export type AuditEntry = { id: string; at: string; actor: string; action: string; result: string; resourceType: string; metadata: Record<string, unknown> };

type TeamRow = { user_id: string; full_name: string | null; email: string | null; roles: string[]; since: string };
type InvRow = { id: string; email: string; role: StaffRole; invited_by_name: string | null; state: InvitationState; expires_at: string; created_at: string };
type AuditRow = { id: string; created_at: string; actor_name: string | null; action: string; resource_type: string; result: string; metadata: Record<string, unknown> | null };

const isStaffRole = (r: string): r is StaffRole => r in ROLE_LABEL;

export async function fetchTeam(): Promise<TeamMember[]> {
  const { data, error } = await requireSupabase().rpc("admin_list_team");
  if (error) throw error;
  return ((data ?? []) as TeamRow[]).map((r) => ({ userId: r.user_id, name: r.full_name?.trim() || "Membre", email: r.email ?? "", roles: r.roles.filter(isStaffRole), since: r.since }))
    .filter((m) => m.roles.length > 0);
}
export async function fetchInvitations(): Promise<Invitation[]> {
  const { data, error } = await requireSupabase().rpc("admin_list_invitations");
  if (error) throw error;
  return ((data ?? []) as InvRow[]).map((r) => ({ id: r.id, email: r.email, role: r.role, invitedBy: r.invited_by_name?.trim() || "—", state: r.state, expiresAt: r.expires_at, createdAt: r.created_at }));
}

export const AUDIT_PAGE = 30;
export async function fetchAudit(before: string | null): Promise<AuditEntry[]> {
  const { data, error } = await requireSupabase().rpc("admin_audit_feed", { p_limit: AUDIT_PAGE, p_before: before, p_action: null });
  if (error) throw error;
  return ((data ?? []) as AuditRow[]).map((r) => ({ id: r.id, at: r.created_at, actor: r.actor_name?.trim() || "Système", action: r.action, result: r.result, resourceType: r.resource_type, metadata: r.metadata ?? {} }));
}

const ACTION_TEXT: Record<string, string> = {
  suspend_user: "a suspendu un compte", ban_user: "a banni un compte", reactivate_user: "a réactivé un compte", verify_user: "a vérifié un compte",
  review_verification: "a traité une demande de vérification", set_listing_status: "a modifié le statut d'une annonce", handle_report: "a traité un signalement",
  assign_ticket: "a assigné un ticket", invite_staff: "a invité un membre de l'équipe", revoke_invitation: "a révoqué une invitation",
  accept_invitation: "a accepté une invitation à l'équipe", grant_role: "a attribué un rôle", revoke_role: "a retiré un rôle",
  review_university_suggestion: "a traité une suggestion d'université", close_ticket: "a fermé un ticket", reply_ticket: "a répondu à un ticket",
};
export function describeAudit(e: AuditEntry): string {
  const role = typeof e.metadata["role"] === "string" && isStaffRole(e.metadata["role"]) ? ` (${ROLE_LABEL[e.metadata["role"]]})` : "";
  const base = ACTION_TEXT[e.action] ?? `a effectué « ${e.action.replace(/_/g, " ")} »`;
  return e.result === "success" ? `${base}${role}` : `a tenté ${base.replace(/^a /, "de ")}${role} — refusé`;
}

const ERRORS: Record<string, string> = {
  forbidden: "Réservé aux administrateurs.", not_admin: "Réservé aux administrateurs.",
  requires_super_admin: "Seul un super-administrateur peut gérer les administrateurs.",
  mfa_required: "Cette action exige une session sécurisée : validez votre code de double authentification (page Sécurité).",
  invalid_role: "Rôle non valide.", invalid_email: "Adresse e-mail non valide.", already_invited: "Une invitation est déjà en attente pour cette adresse et ce rôle.",
  not_found: "Invitation introuvable.", not_pending: "Cette invitation n'est plus en attente.",
};
async function call(fn: string, args: Record<string, unknown>): Promise<void> {
  const { data, error } = await requireSupabase().rpc(fn, args);
  if (error) {
    // Seul garde-fou en exception de revoke_role : ne pas retirer son propre rôle d'administration.
    if (/auto-verrouillage/i.test(error.message ?? "")) throw new UserFacingError("Vous ne pouvez pas retirer votre propre rôle d'administration : demandez-le à un autre super-administrateur.");
    throw error;
  }
  const r = data as { success?: boolean; error?: string } | null;
  if (!r?.success) throw new UserFacingError(ERRORS[r?.error ?? ""] ?? "Action impossible.");
}

const enabled = () => getSupabase() !== null;
export const useTeam = () => useQuery({ queryKey: ["admin-team", "members"], queryFn: fetchTeam, enabled: enabled(), staleTime: 10_000 });
export const useInvitations = () => useQuery({ queryKey: ["admin-team", "invitations"], queryFn: fetchInvitations, enabled: enabled(), placeholderData: keepPreviousData, staleTime: 10_000 });
export const useAuditFeed = () => useInfiniteQuery({
  queryKey: ["admin-team", "audit"], initialPageParam: null as string | null, enabled: enabled(), staleTime: 10_000,
  queryFn: ({ pageParam }) => fetchAudit(pageParam),
  getNextPageParam: (last) => (last.length === AUDIT_PAGE ? last[last.length - 1]!.at : undefined),
});

export function useTeamActions() {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["admin-team"] }); };
  return {
    invite: useMutation({ mutationFn: (v: { email: string; role: StaffRole }) => call("admin_invite_staff", { p_email: v.email, p_role: v.role }), onSettled: refresh }),
    revokeInvitation: useMutation({ mutationFn: (id: string) => call("admin_revoke_invitation", { p_invitation_id: id }), onSettled: refresh }),
    grant: useMutation({ mutationFn: (v: { userId: string; role: StaffRole }) => call("grant_role", { p_user_id: v.userId, p_role: v.role }), onSettled: refresh }),
    revoke: useMutation({ mutationFn: (v: { userId: string; role: StaffRole }) => call("revoke_role", { p_user_id: v.userId, p_role: v.role }), onSettled: refresh }),
    errorText: (e: unknown, fallback = "Action impossible.") => friendlyError(e, fallback),
  };
}

/** Côté invité : accepter une invitation reçue en notification. L'adresse e-mail du compte doit être celle de l'invitation et confirmée. */
export async function acceptStaffInvitation(id: string): Promise<StaffRole> {
  const { data, error } = await requireSupabase().rpc("accept_staff_invitation", { p_invitation_id: id });
  if (error) throw error;
  const r = data as { success?: boolean; role?: StaffRole; error?: string } | null;
  if (!r?.success) throw new UserFacingError("Cette invitation n'est plus valable ou ne correspond pas à votre adresse e-mail.");
  return r.role ?? "support";
}
