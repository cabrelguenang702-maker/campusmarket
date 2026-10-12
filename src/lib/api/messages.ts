import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { timeAgo, type CategorySlug } from "../domain";

/* Messagerie 1-à-1 : conversations, messages immuables, pièces jointes (bucket privé message-attachments),
 * blocage. Temps réel via Supabase Realtime (la RLS filtre ce que chaque utilisateur reçoit). */

const BUCKET = "message-attachments";
const MAX_ATTACHMENT = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export type Conversation = {
  id: string;
  productId: string | null;
  otherId: string;
  name: string;
  avatarUrl: string | null;
  campus: string | null;
  verified: boolean;
  last: string;
  lastAt: string | null;
  lastLabel: string;
  unread: number;
  archived: boolean;
  /** Historique antérieur à cette date effacé pour moi. */
  clearedBefore: string | null;
  hidden: boolean;
  blockedByMe: boolean;
  blockedMe: boolean;
  product: { name: string; price: number; category: CategorySlug; status: string } | null;
};

type ConvRow = {
  id: string; product_id: string | null; last_message_at: string | null; last_message_preview: string | null; other_id: string; other_name: string;
  other_avatar_url: string | null; other_campus: string | null; other_verified: boolean; archived: boolean; deleted_at: string | null; unread: number;
  product_name: string | null; product_price: number | null; product_category: CategorySlug | null; product_status: string | null;
  blocked_by_me: boolean; blocked_me: boolean; hidden: boolean;
};

function mapConversation(r: ConvRow): Conversation {
  return {
    id: r.id, productId: r.product_id, otherId: r.other_id, name: r.other_name, avatarUrl: r.other_avatar_url, campus: r.other_campus, verified: r.other_verified,
    last: r.last_message_preview ?? "Nouvelle conversation", lastAt: r.last_message_at, lastLabel: r.last_message_at ? timeAgo(r.last_message_at) : "", unread: r.unread,
    archived: r.archived, clearedBefore: r.deleted_at, hidden: r.hidden, blockedByMe: r.blocked_by_me, blockedMe: r.blocked_me,
    product: r.product_name && r.product_price !== null && r.product_category ? { name: r.product_name, price: r.product_price, category: r.product_category, status: r.product_status ?? "published" } : null,
  };
}

export async function fetchConversations(): Promise<Conversation[]> {
  const { data, error } = await requireSupabase().from("my_conversations").select("*").order("last_message_at", { ascending: false, nullsFirst: false }).limit(200);
  if (error) throw error;
  return ((data ?? []) as ConvRow[]).filter((r) => !r.hidden).map(mapConversation);
}

export async function fetchConversation(id: string): Promise<Conversation | null> {
  const { data, error } = await requireSupabase().from("my_conversations").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapConversation(data as ConvRow) : null;
}

/* ---------- Messages ---------- */

export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";
export type Attachment = { kind: "image" | "file"; name: string; size: string; url?: string | undefined };
export type ChatMessage = { id: string; from: "me" | "them"; time: string; createdAt: string; status?: MessageStatus; text?: string; attachment?: Attachment };

type MsgRow = {
  id: string; sender_id: string; body: string | null; attachment_path: string | null; attachment_kind: string | null; attachment_name: string | null;
  attachment_size_bytes: number | null; delivered_at: string | null; read_at: string | null; created_at: string;
};

export function formatSize(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export async function fetchMessages(conversationId: string, userId: string, clearedBefore: string | null): Promise<ChatMessage[]> {
  const sb = requireSupabase();
  let q = sb.from("messages").select("id, sender_id, body, attachment_path, attachment_kind, attachment_name, attachment_size_bytes, delivered_at, read_at, created_at").eq("conversation_id", conversationId);
  if (clearedBefore) q = q.gt("created_at", clearedBefore);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  const rows = ((data ?? []) as MsgRow[]).reverse();

  const paths = rows.flatMap((m) => (m.attachment_path ? [m.attachment_path] : []));
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const signed = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
    if (!signed.error) for (const s of signed.data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }

  return rows.map((m) => {
    const mine = m.sender_id === userId;
    const msg: ChatMessage = { id: m.id, from: mine ? "me" : "them", time: clock(m.created_at), createdAt: m.created_at };
    if (mine) msg.status = m.read_at ? "read" : m.delivered_at ? "delivered" : "sent";
    if (m.body) msg.text = m.body;
    if (m.attachment_path) msg.attachment = { kind: m.attachment_kind === "image" ? "image" : "file", name: m.attachment_name ?? "Pièce jointe", size: formatSize(m.attachment_size_bytes ?? 0), url: urls.get(m.attachment_path) };
    return msg;
  });
}

export function validateAttachment(file: File): string | null {
  if (file.size > MAX_ATTACHMENT) return "Fichier trop lourd : 10 Mo maximum.";
  if (!ATTACHMENT_TYPES.includes(file.type)) return "Format non pris en charge : JPG, PNG, WebP ou PDF.";
  return null;
}

export async function sendMessage(input: { conversationId: string; userId: string; body: string; file?: File | null }): Promise<void> {
  const sb = requireSupabase();
  const body = input.body.trim();
  let attachment: { attachment_path: string; attachment_kind: string; attachment_name: string; attachment_size_bytes: number } | null = null;
  if (input.file) {
    const ext = input.file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
    const path = `${input.conversationId}/${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(path, input.file, { contentType: input.file.type, upsert: false });
    if (up.error) throw up.error;
    attachment = { attachment_path: path, attachment_kind: input.file.type.startsWith("image/") ? "image" : "file", attachment_name: input.file.name.slice(0, 120), attachment_size_bytes: input.file.size };
  }
  const { error } = await sb.from("messages").insert({ conversation_id: input.conversationId, sender_id: input.userId, body: body || null, ...(attachment ?? {}) });
  if (error) {
    if (attachment) await sb.storage.from(BUCKET).remove([attachment.attachment_path]);
    throw error;
  }
}

/** Marque reçus puis lus les messages de l'autre participant dans cette conversation. */
export async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  const sb = requireSupabase();
  const now = new Date().toISOString();
  const a = await sb.from("messages").update({ delivered_at: now }).eq("conversation_id", conversationId).neq("sender_id", userId).is("delivered_at", null);
  if (a.error) throw a.error;
  const b = await sb.from("messages").update({ read_at: now }).eq("conversation_id", conversationId).neq("sender_id", userId).is("read_at", null);
  if (b.error) throw b.error;
}

/** Messages reçus mais pas encore « reçus » (appareil allumé, conversation non ouverte). */
export async function markAllDelivered(userId: string): Promise<void> {
  const { error } = await requireSupabase().from("messages").update({ delivered_at: new Date().toISOString() }).neq("sender_id", userId).is("delivered_at", null);
  if (error) throw error;
}

/* ---------- États de la conversation ---------- */

async function patchState(conversationId: string, userId: string, patch: { archived?: boolean; deleted_at?: string | null }): Promise<void> {
  const { data, error } = await requireSupabase().from("conversation_states").update(patch).eq("conversation_id", conversationId).eq("user_id", userId).select("conversation_id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Conversation introuvable.");
}
export const setArchived = (conversationId: string, userId: string, archived: boolean) => patchState(conversationId, userId, { archived });
export const clearForMe = (conversationId: string, userId: string) => patchState(conversationId, userId, { deleted_at: new Date().toISOString(), archived: false });

export async function setBlocked(blockerId: string, blockedId: string, blocked: boolean): Promise<void> {
  const sb = requireSupabase();
  if (blocked) {
    const { error } = await sb.from("blocked_users").insert({ blocker_id: blockerId, blocked_id: blockedId });
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await sb.from("blocked_users").delete().eq("blocker_id", blockerId).eq("blocked_id", blockedId);
    if (error) throw error;
  }
}

/* ---------- Recherche d'un membre ---------- */

export type Person = { id: string; name: string; campus: string | null; verified: boolean; avatarUrl: string | null };

export async function searchPeople(term: string, selfId: string): Promise<Person[]> {
  const t = term.replace(/[%_\\,.()*"':;]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  let q = requireSupabase().from("profiles").select("id, full_name, campus, verified, avatar_url").eq("discoverable", true).neq("id", selfId);
  q = t ? q.or(`full_name.ilike.%${t}%,campus.ilike.%${t}%`) : q.order("created_at", { ascending: false });
  const { data, error } = await q.limit(20);
  if (error) throw error;
  return ((data ?? []) as { id: string; full_name: string; campus: string | null; verified: boolean; avatar_url: string | null }[]).map((p) => ({ id: p.id, name: p.full_name, campus: p.campus, verified: p.verified, avatarUrl: p.avatar_url }));
}

/* ---------- Hooks ---------- */

const enabled = () => getSupabase() !== null;

export function useConversations(userId: string | undefined) {
  return useQuery({ queryKey: ["conversations", userId], queryFn: fetchConversations, enabled: enabled() && !!userId, staleTime: 10_000 });
}

export function useConversation(id: string, userId: string | undefined) {
  return useQuery({ queryKey: ["conversation", id], queryFn: () => fetchConversation(id), enabled: enabled() && !!userId, staleTime: 10_000 });
}

export function useThreadMessages(id: string, userId: string | undefined, clearedBefore: string | null | undefined, ready: boolean) {
  return useQuery({ queryKey: ["messages", id, clearedBefore ?? ""], queryFn: () => fetchMessages(id, userId!, clearedBefore ?? null), enabled: enabled() && !!userId && ready, staleTime: 5_000 });
}

/** Rafraîchit liste et conversation à chaque message ou changement d'état reçu en temps réel. */
export function useMessagesRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["conversation"] });
      void qc.invalidateQueries({ queryKey: ["messages"] });
    };
    const channel = sb
      .channel(`messages-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        refresh();
        // Un message entrant est « reçu » dès que l'application est ouverte.
        const row = payload.new as { sender_id?: string; delivered_at?: string | null } | undefined;
        if (payload.eventType === "INSERT" && row && row.sender_id !== userId && !row.delivered_at) void markAllDelivered(userId).catch(() => undefined);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_states" }, refresh)
      .subscribe();
    void markAllDelivered(userId).catch(() => undefined);
    return () => { void sb.removeChannel(channel); };
  }, [userId, qc]);
}

/** « Écrit… » via Realtime broadcast (éphémère, rien n'est stocké). */
export function useTyping(conversationId: string, userId: string | undefined) {
  const [typing, setTyping] = useState(false);
  const channelRef = useRef<ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null>(null);
  const lastSent = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    const channel = sb.channel(`typing-${conversationId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, (msg) => {
        if ((msg.payload as { user?: string } | undefined)?.user === userId) return;
        setTyping(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setTyping(false), 4000);
      })
      .subscribe();
    channelRef.current = channel;
    return () => { window.clearTimeout(timer.current); channelRef.current = null; void sb.removeChannel(channel); };
  }, [conversationId, userId]);

  const notify = useCallback(() => {
    const now = Date.now();
    if (!channelRef.current || now - lastSent.current < 2500) return;
    lastSent.current = now;
    void channelRef.current.send({ type: "broadcast", event: "typing", payload: { user: userId } });
  }, [userId]);

  return { typing, notify };
}

export function useMessageActions(userId: string | undefined) {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["conversations"] }); void qc.invalidateQueries({ queryKey: ["conversation"] }); void qc.invalidateQueries({ queryKey: ["messages"] }); };
  return {
    send: useMutation({ mutationFn: (v: { conversationId: string; body: string; file?: File | null }) => sendMessage({ ...v, userId: userId! }), onSuccess: refresh }),
    read: useMutation({ mutationFn: (conversationId: string) => markConversationRead(conversationId, userId!), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["conversations"] }); void qc.invalidateQueries({ queryKey: ["unread-messages"] }); } }),
    archive: useMutation({ mutationFn: (v: { conversationId: string; archived: boolean }) => setArchived(v.conversationId, userId!, v.archived), onSuccess: refresh }),
    clear: useMutation({ mutationFn: (conversationId: string) => clearForMe(conversationId, userId!), onSuccess: refresh }),
    block: useMutation({ mutationFn: (v: { otherId: string; blocked: boolean }) => setBlocked(userId!, v.otherId, v.blocked), onSuccess: refresh }),
  };
}
