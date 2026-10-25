import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { UserFacingError, friendlyError } from "./errors";
import type { ChatMessage } from "./messages";

/* Aide et support : FAQ publique (lisible sans connexion) et tickets. Les règles sont tenues par la base (0019, 0051) :
 * un demandeur ne voit que ses tickets, ne peut changer que leur statut (fermer), ne peut pas écrire sur un ticket fermé,
 * est limité à 5 tickets et 30 messages par heure ; le statut « résolu » et l'assignation relèvent du personnel. */

const BUCKET = "support-attachments";
const MAX_ATTACHMENT = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTicketId = (s: string) => UUID.test(s);

export type FaqCategory = { slug: string; name: string };
export type FaqItem = { id: string; category: string; question: string; answer: string };
export type TicketStatus = "ouvert" | "en_attente" | "resolu" | "ferme";

export const ticketStatusLabel: Record<TicketStatus, string> = {
  ouvert: "Ouvert",
  en_attente: "En attente de votre réponse",
  resolu: "Résolu",
  ferme: "Fermé",
};

export type Ticket = {
  id: string;
  subject: string;
  category: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  lastPreview: string | null;
};

/** Message d'erreur affichable : ajoute au traitement commun la limite de fréquence (code P0429) des créations. */
export function supportError(error: unknown, fallback = "Une erreur est survenue. Réessayez dans un instant."): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "P0429") return "Vous avez ouvert beaucoup de tickets en peu de temps. Réessayez dans une heure.";
  return friendlyError(error, fallback);
}

/* ---------- FAQ ---------- */

export async function fetchFaq(): Promise<{ categories: FaqCategory[]; items: FaqItem[] }> {
  const sb = requireSupabase();
  const [cats, items] = await Promise.all([
    sb.from("faq_categories").select("slug, name").order("sort_order", { ascending: true }),
    sb.from("faq_items").select("id, category_slug, question, answer").eq("published", true).order("sort_order", { ascending: true }),
  ]);
  if (cats.error) throw cats.error;
  if (items.error) throw items.error;
  return {
    categories: (cats.data ?? []) as FaqCategory[],
    items: ((items.data ?? []) as { id: string; category_slug: string; question: string; answer: string }[]).map((r) => ({
      id: r.id,
      category: r.category_slug,
      question: r.question,
      answer: r.answer,
    })),
  };
}

/* ---------- Tickets ---------- */

type TicketRow = {
  id: string; subject: string; category_slug: string; status: TicketStatus; created_at: string; updated_at: string;
  last_message_at: string; last_message_preview: string | null;
};
const TICKET_COLUMNS = "id, subject, category_slug, status, created_at, updated_at, last_message_at, last_message_preview";

const toTicket = (r: TicketRow): Ticket => ({
  id: r.id, subject: r.subject, category: r.category_slug, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
  lastMessageAt: r.last_message_at, lastPreview: r.last_message_preview,
});

export async function fetchTickets(userId: string): Promise<Ticket[]> {
  const { data, error } = await requireSupabase()
    .from("support_tickets").select(TICKET_COLUMNS).eq("user_id", userId).order("last_message_at", { ascending: false }).limit(100);
  if (error) throw error;
  return ((data ?? []) as TicketRow[]).map(toTicket);
}

export async function fetchTicket(id: string, userId: string): Promise<Ticket | null> {
  if (!isTicketId(id)) return null;
  const { data, error } = await requireSupabase().from("support_tickets").select(TICKET_COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ? toTicket(data as TicketRow) : null;
}

type MessageRow = { id: string; sender_id: string; body: string | null; attachment_path: string | null; attachment_name: string | null; created_at: string };

const stamp = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const hour = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `Aujourd'hui ${hour}` : `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} ${hour}`;
};

export async function fetchTicketMessages(ticketId: string, userId: string): Promise<ChatMessage[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("support_ticket_messages").select("id, sender_id, body, attachment_path, attachment_name, created_at")
    .eq("ticket_id", ticketId).order("created_at", { ascending: true }).limit(300);
  if (error) throw error;
  const rows = (data ?? []) as MessageRow[];

  const paths = rows.flatMap((m) => (m.attachment_path ? [m.attachment_path] : []));
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const signed = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
    if (!signed.error) for (const s of signed.data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }

  return rows.map((m) => {
    const msg: ChatMessage = { id: m.id, from: m.sender_id === userId ? "me" : "them", time: stamp(m.created_at), createdAt: m.created_at };
    if (m.body) msg.text = m.body;
    if (m.attachment_path) {
      const name = m.attachment_name ?? "Pièce jointe";
      const isImage = /\.(jpe?g|png|webp)$/i.test(m.attachment_path);
      msg.attachment = { kind: isImage ? "image" : "file", name, size: isImage ? "Image" : "PDF", url: urls.get(m.attachment_path) };
    }
    return msg;
  });
}

export function validateAttachment(file: File): string | null {
  if (file.size > MAX_ATTACHMENT) return "Fichier trop lourd : 10 Mo maximum.";
  if (!ATTACHMENT_TYPES.includes(file.type)) return "Format non pris en charge : JPG, PNG, WebP ou PDF.";
  return null;
}

/** Ajoute un message (texte et/ou pièce jointe) à un ticket. La pièce jointe est envoyée d'abord, puis retirée si le message est refusé. */
export async function sendTicketMessage(input: { ticketId: string; userId: string; body: string; file?: File | null }): Promise<void> {
  const sb = requireSupabase();
  const body = input.body.trim();
  let attachment: { attachment_path: string; attachment_name: string } | null = null;
  if (input.file) {
    const ext = input.file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
    const path = `${input.ticketId}/${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(path, input.file, { contentType: input.file.type, upsert: false });
    if (up.error) throw up.error;
    attachment = { attachment_path: path, attachment_name: input.file.name.slice(0, 120) };
  }
  const { error } = await sb.from("support_ticket_messages").insert({ ticket_id: input.ticketId, sender_id: input.userId, body: body || null, ...(attachment ?? {}) });
  if (error) {
    if (attachment) await sb.storage.from(BUCKET).remove([attachment.attachment_path]);
    throw error;
  }
}

/** Crée un ticket et son premier message en une seule opération côté base ; la capture éventuelle part ensuite comme second message. */
export async function createTicket(input: { userId: string; category: string; subject: string; body: string; file?: File | null }): Promise<{ id: string; attachmentFailed: boolean }> {
  const { data, error } = await requireSupabase().rpc("create_support_ticket", { p_category: input.category, p_subject: input.subject, p_body: input.body });
  if (error) throw error;
  const id = String(data);
  let attachmentFailed = false;
  if (input.file) {
    try {
      await sendTicketMessage({ ticketId: id, userId: input.userId, body: "", file: input.file });
    } catch {
      attachmentFailed = true;
    }
  }
  return { id, attachmentFailed };
}

/** Fermeture par le demandeur : définitive (un ticket fermé ne se rouvre pas, il faut en ouvrir un nouveau). */
export async function closeTicket(id: string): Promise<void> {
  const { data, error } = await requireSupabase().from("support_tickets").update({ status: "ferme" }).eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new UserFacingError("Ticket introuvable ou déjà fermé.");
}

/* ---------- Hooks ---------- */

const enabled = () => getSupabase() !== null;

export function useFaq() {
  return useQuery({ queryKey: ["faq"], queryFn: fetchFaq, enabled: enabled(), staleTime: 5 * 60_000 });
}

export function useTickets(userId: string | undefined) {
  return useQuery({ queryKey: ["support-tickets", userId], queryFn: () => fetchTickets(userId!), enabled: enabled() && !!userId, staleTime: 10_000 });
}

export function useTicket(id: string, userId: string | undefined) {
  return useQuery({ queryKey: ["support-ticket", id], queryFn: () => fetchTicket(id, userId!), enabled: enabled() && !!userId, staleTime: 10_000, refetchInterval: 20_000 });
}

export function useTicketMessages(id: string, userId: string | undefined, ready: boolean) {
  return useQuery({ queryKey: ["support-messages", id], queryFn: () => fetchTicketMessages(id, userId!), enabled: enabled() && !!userId && ready, staleTime: 5_000, refetchInterval: 20_000 });
}

export function useSupportActions(userId: string | undefined) {
  const qc = useQueryClient();
  const refresh = (ticketId?: string) => {
    void qc.invalidateQueries({ queryKey: ["support-tickets"] });
    if (ticketId) {
      void qc.invalidateQueries({ queryKey: ["support-ticket", ticketId] });
      void qc.invalidateQueries({ queryKey: ["support-messages", ticketId] });
    }
  };
  const create = useMutation({
    mutationFn: (v: { category: string; subject: string; body: string; file?: File | null }) => createTicket({ userId: userId!, ...v }),
    onSuccess: (r) => refresh(r.id),
  });
  const send = useMutation({
    mutationFn: (v: { ticketId: string; body: string; file?: File | null }) => sendTicketMessage({ userId: userId!, ...v }),
    onSuccess: (_r, v) => refresh(v.ticketId),
  });
  const close = useMutation({ mutationFn: (ticketId: string) => closeTicket(ticketId), onSuccess: (_r, id) => refresh(id) });
  return { create, send, close };
}
