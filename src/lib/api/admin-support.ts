import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { UserFacingError, friendlyError } from "./errors";
import { fetchTicketMessages, sendTicketMessage, type TicketStatus } from "./support";

/* Support côté personnel. Les règles sont dans la base (0019, 0020, 0053) : lecture de tous les tickets réservée au personnel,
 * seul le statut se modifie directement, l'assignation passe par admin_assign_ticket (agents vérifiés, journalisée), un
 * ticket fermé ne reçoit plus de message tant qu'il n'est pas rouvert. */

export const staffStatusLabel: Record<TicketStatus, string> = {
  ouvert: "À traiter",
  en_attente: "En attente du demandeur",
  resolu: "Résolu",
  ferme: "Fermé",
};

export type AdminTicket = {
  id: string; subject: string; category: string; status: TicketStatus; createdAt: string; lastMessageAt: string;
  lastPreview: string | null; assignedTo: string | null; requesterName: string;
};
export type Agent = { id: string; name: string };
export type HistoryEntry = { at: string; kind: "assign" | "status"; actor: string; from: string | null; to: string | null };

type Row = {
  id: string; subject: string; category_slug: string; status: TicketStatus; created_at: string; last_message_at: string;
  last_message_preview: string | null; assigned_to: string | null; requester: { full_name: string | null } | null;
};

export async function fetchAdminTickets(): Promise<AdminTicket[]> {
  const { data, error } = await requireSupabase()
    .from("support_tickets")
    .select("id, subject, category_slug, status, created_at, last_message_at, last_message_preview, assigned_to, requester:profiles!user_id(full_name)")
    .order("last_message_at", { ascending: false }).limit(200);
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id, subject: r.subject, category: r.category_slug, status: r.status, createdAt: r.created_at, lastMessageAt: r.last_message_at,
    lastPreview: r.last_message_preview, assignedTo: r.assigned_to, requesterName: r.requester?.full_name?.trim() || "Étudiant",
  }));
}

export async function fetchAgents(): Promise<Agent[]> {
  const { data, error } = await requireSupabase().rpc("admin_list_support_agents");
  if (error) throw error;
  return ((data ?? []) as { id: string; full_name: string | null }[]).map((a) => ({ id: a.id, name: a.full_name?.trim() || "Agent" }));
}

export async function fetchHistory(ticketId: string): Promise<HistoryEntry[]> {
  const { data, error } = await requireSupabase().rpc("admin_ticket_history", { p_ticket_id: ticketId });
  if (error) throw error;
  return ((data ?? []) as { at: string; kind: "assign" | "status"; actor_name: string | null; from_value: string | null; to_value: string | null }[])
    .map((h) => ({ at: h.at, kind: h.kind, actor: h.actor_name?.trim() || "Quelqu'un", from: h.from_value, to: h.to_value }));
}

const ASSIGN_ERRORS: Record<string, string> = {
  forbidden: "L'assignation est réservée à l'équipe support et aux administrateurs.",
  not_found: "Ce ticket n'existe plus.",
  ticket_closed: "Ce ticket est fermé : rouvrez-le avant de l'assigner.",
  not_an_agent: "Cette personne n'est pas un agent de support actif.",
  no_change: "Ce ticket est déjà assigné à cette personne.",
};

export async function assignTicket(ticketId: string, agentId: string | null): Promise<void> {
  const { data, error } = await requireSupabase().rpc("admin_assign_ticket", { p_ticket_id: ticketId, p_agent_id: agentId });
  if (error) throw error;
  const r = data as { success?: boolean; error?: string } | null;
  if (!r?.success) throw new UserFacingError(ASSIGN_ERRORS[r?.error ?? ""] ?? "Assignation impossible.");
}

export async function setTicketStatus(ticketId: string, status: TicketStatus): Promise<void> {
  const { data, error } = await requireSupabase().from("support_tickets").update({ status }).eq("id", ticketId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new UserFacingError("Changement refusé : vérifiez vos droits sur ce ticket.");
}

const enabled = () => getSupabase() !== null;

export function useAdminTickets() {
  return useQuery({ queryKey: ["admin-support", "tickets"], queryFn: fetchAdminTickets, enabled: enabled(), staleTime: 5_000, refetchInterval: 20_000 });
}
export function useAgents() {
  return useQuery({ queryKey: ["admin-support", "agents"], queryFn: fetchAgents, enabled: enabled(), staleTime: 5 * 60_000 });
}
export function useAdminTicketMessages(ticketId: string | null, staffId: string | undefined) {
  return useQuery({ queryKey: ["admin-support", "messages", ticketId], queryFn: () => fetchTicketMessages(ticketId!, staffId!), enabled: enabled() && !!ticketId && !!staffId, staleTime: 3_000, refetchInterval: 12_000 });
}
export function useTicketHistory(ticketId: string | null) {
  return useQuery({ queryKey: ["admin-support", "history", ticketId], queryFn: () => fetchHistory(ticketId!), enabled: enabled() && !!ticketId, staleTime: 5_000 });
}

export function useAdminSupportActions(staffId: string | undefined) {
  const qc = useQueryClient();
  const refresh = (ticketId: string) => {
    void qc.invalidateQueries({ queryKey: ["admin-support", "tickets"] });
    void qc.invalidateQueries({ queryKey: ["admin-support", "messages", ticketId] });
    void qc.invalidateQueries({ queryKey: ["admin-support", "history", ticketId] });
  };
  const assign = useMutation({ mutationFn: (v: { ticketId: string; agentId: string | null }) => assignTicket(v.ticketId, v.agentId), onSettled: (_r, _e, v) => refresh(v.ticketId) });
  const status = useMutation({ mutationFn: (v: { ticketId: string; status: TicketStatus }) => setTicketStatus(v.ticketId, v.status), onSettled: (_r, _e, v) => refresh(v.ticketId) });
  const reply = useMutation({ mutationFn: (v: { ticketId: string; body: string; file?: File | null }) => sendTicketMessage({ userId: staffId!, ...v }), onSettled: (_r, _e, v) => refresh(v.ticketId) });
  return { assign, status, reply, errorText: (e: unknown, fallback = "Action impossible.") => friendlyError(e, fallback) };
}
