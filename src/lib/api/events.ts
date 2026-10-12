import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { dateLabel, displayStatus, styleOfEventCategory, type CheckResult, type DbEventStatus, type EventItem, type MyTicket, type ProgramItem, type TicketStatus } from "../events-model";

/* Événements et billetterie. Les règles (capacité, doublons, événement terminé, prix) sont tenues par la base ;
 * un billet payant n'est valide qu'une fois le paiement confirmé par CamPay (déclencheur apply_payment_settlement). */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

const SELECT = "id, created_by, organizer_space_id, organizer_name, category_slug, name, description, venue, campus, city, starts_at, ends_at, capacity, price, status, tickets_sold, program, category:event_categories!category_slug(name)";
type Row = {
  id: string; created_by: string; organizer_space_id: string | null; organizer_name: string; category_slug: string; name: string; description: string;
  venue: string; campus: string; city: string; starts_at: string; ends_at: string | null; capacity: number; price: number; status: DbEventStatus;
  tickets_sold: number; program: unknown; category: { name: string } | { name: string }[] | null;
};

function parseProgram(raw: unknown): ProgramItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p): ProgramItem[] => {
    if (!p || typeof p !== "object") return [];
    const o = p as { time?: unknown; title?: unknown };
    return typeof o.title === "string" && o.title ? [{ time: typeof o.time === "string" ? o.time : "", title: o.title }] : [];
  });
}

function toEvent(r: Row): EventItem {
  const cat = Array.isArray(r.category) ? r.category[0] : r.category;
  const style = styleOfEventCategory(r.category_slug);
  const base = { dbStatus: r.status, startsAt: r.starts_at, endsAt: r.ends_at, capacity: r.capacity, taken: r.tickets_sold };
  return {
    id: r.id, name: r.name, category: cat?.name ?? r.category_slug, categorySlug: r.category_slug, tone: style.tone, icon: style.icon,
    startsAt: r.starts_at, endsAt: r.ends_at, dateLabel: dateLabel(r.starts_at), place: r.venue, campus: r.campus, city: r.city,
    organizer: r.organizer_name, organizerSpaceId: r.organizer_space_id, createdBy: r.created_by, description: r.description,
    price: r.price, capacity: r.capacity, taken: r.tickets_sold, program: parseProgram(r.program), status: displayStatus(base), dbStatus: r.status,
  };
}

/** Événements publiés : à venir d'abord (du plus proche au plus lointain), puis les terminés ou annulés (du plus récent au plus ancien). */
export async function fetchEvents(): Promise<EventItem[]> {
  const { data, error } = await requireSupabase().from("events").select(SELECT).in("status", ["published", "cancelled", "completed"]).order("starts_at", { ascending: false }).limit(150);
  if (error) throw error;
  const list = ((data ?? []) as unknown as Row[]).map(toEvent);
  const upcoming = list.filter((e) => e.status === "a-venir" || e.status === "complet").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = list.filter((e) => e.status === "termine" || e.status === "annule");
  return [...upcoming, ...past];
}

/** Événements à venir (ou complets) d'un campus, du plus proche au plus lointain. */
export async function fetchCampusEvents(campus: string): Promise<EventItem[]> {
  const { data, error } = await requireSupabase().from("events").select(SELECT).eq("campus", campus).eq("status", "published").order("starts_at", { ascending: true }).limit(60);
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(toEvent).filter((e) => e.status === "a-venir" || e.status === "complet");
}

export async function fetchEvent(id: string): Promise<EventItem | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await requireSupabase().from("events").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toEvent(data as unknown as Row) : null;
}

export type EventCategory = { slug: string; name: string };
export async function fetchEventCategories(): Promise<EventCategory[]> {
  const { data, error } = await requireSupabase().from("event_categories").select("slug, name").order("sort_order");
  if (error) throw error;
  return (data ?? []) as EventCategory[];
}

/** Mes événements organisés (brouillons compris). */
export async function fetchMyOrganizedEvents(userId: string): Promise<EventItem[]> {
  const { data, error } = await requireSupabase().from("events").select(SELECT).eq("created_by", userId).order("starts_at", { ascending: false }).limit(100);
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(toEvent);
}

/* ---------- Mes billets ---------- */
type TicketRow = { id: string; event_id: string; status: TicketStatus; qr_code: string | null; expires_at: string };

export async function fetchMyTickets(userId: string): Promise<MyTicket[]> {
  const { data, error } = await requireSupabase().from("event_tickets").select("id, event_id, status, qr_code, expires_at").eq("attendee_id", userId).in("status", ["pending_payment", "valid", "used"]);
  if (error) throw error;
  return ((data ?? []) as TicketRow[]).map((t) => ({ id: t.id, eventId: t.event_id, status: t.status, code: t.qr_code, expiresAt: t.expires_at }));
}

/** Événements auxquels j'ai un billet valide ou utilisé (onglet « Événements » du profil). */
export async function fetchMyEvents(userId: string): Promise<EventItem[]> {
  const { data, error } = await requireSupabase().from("event_tickets").select(`status, event:events!event_id(${SELECT})`).eq("attendee_id", userId).in("status", ["valid", "used"]);
  if (error) throw error;
  type R = { event: Row | Row[] | null };
  const list = ((data ?? []) as unknown as R[]).flatMap((r) => { const e = Array.isArray(r.event) ? r.event[0] : r.event; return e ? [toEvent(e)] : []; });
  return list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

const eventsKey = ["events", "list"] as const;
const ticketsKey = (userId: string | undefined) => ["events", "tickets", userId] as const;

export function useEvents() {
  return useQuery({ queryKey: eventsKey, queryFn: fetchEvents, enabled: getSupabase() !== null, staleTime: 30_000 });
}
export function useEvent(id: string) {
  return useQuery({ queryKey: ["events", "one", id], queryFn: () => fetchEvent(id), enabled: getSupabase() !== null, staleTime: 15_000 });
}
export function useEventCategories() {
  return useQuery({ queryKey: ["events", "categories"], queryFn: fetchEventCategories, enabled: getSupabase() !== null, staleTime: 10 * 60_000 });
}
export function useMyTickets(userId: string | undefined) {
  return useQuery({ queryKey: ticketsKey(userId), queryFn: () => fetchMyTickets(userId!), enabled: !!userId && getSupabase() !== null, staleTime: 10_000 });
}
export function useMyEvents(userId: string | undefined) {
  return useQuery({ queryKey: ["events", "mine", userId], queryFn: () => fetchMyEvents(userId!), enabled: !!userId && getSupabase() !== null, staleTime: 15_000 });
}
export function useMyOrganizedEvents(userId: string | undefined) {
  return useQuery({ queryKey: ["events", "organized", userId], queryFn: () => fetchMyOrganizedEvents(userId!), enabled: !!userId && getSupabase() !== null, staleTime: 15_000 });
}

export type CreateEventInput = {
  name: string; description: string; categorySlug: string; venue: string; campus: string; city: string; startsAt: string; endsAt: string | null;
  capacity: number; price: number; organizerName: string; program: ProgramItem[]; publish: boolean;
};

export function useEventActions(userId: string | undefined) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["events"] })]);
  return {
    refresh,
    /** Inscription à un événement GRATUIT (billet valide tout de suite). Un billet déjà actif (23505) vaut succès. */
    registerFree: useMutation({
      mutationFn: async (eventId: string) => {
        const { error } = await requireSupabase().from("event_tickets").insert({ event_id: eventId, attendee_id: userId!, unit_price: 0, idempotency_key: crypto.randomUUID(), status: "valid" });
        if (error && error.code !== "23505") throw error;
      },
      onSuccess: refresh,
    }),
    cancelTicket: useMutation({
      mutationFn: async (ticketId: string) => {
        const { error } = await requireSupabase().from("event_tickets").update({ status: "cancelled" }).eq("id", ticketId);
        if (error) throw error;
      },
      onSuccess: refresh,
    }),
    create: useMutation({
      mutationFn: async (input: CreateEventInput): Promise<string> => {
        const { data, error } = await requireSupabase().from("events").insert({
          created_by: userId!, organizer_name: input.organizerName.trim(), category_slug: input.categorySlug, name: input.name.trim(), description: input.description.trim(),
          venue: input.venue.trim(), campus: input.campus, city: input.city.trim(), starts_at: input.startsAt, ends_at: input.endsAt, capacity: input.capacity, price: input.price,
          program: input.program.filter((p) => p.title.trim()).map((p) => ({ time: p.time.trim(), title: p.title.trim() })), status: input.publish ? "published" : "draft",
        }).select("id").single();
        if (error) throw error;
        return (data as { id: string }).id;
      },
      onSuccess: refresh,
    }),
    setStatus: useMutation({
      mutationFn: async ({ eventId, status }: { eventId: string; status: "published" | "cancelled" }) => {
        const { data, error } = await requireSupabase().from("events").update({ status }).eq("id", eventId).select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Action non autorisée.");
      },
      onSuccess: refresh,
    }),
  };
}

/* ---------- Contrôle d'entrée (organisateur) ---------- */
export type Attendee = { ticketId: string; userId: string; name: string; avatarUrl: string | null; status: TicketStatus; code: string | null; usedAt: string | null };

export async function fetchAttendees(eventId: string): Promise<Attendee[]> {
  const { data, error } = await requireSupabase().from("event_tickets").select("id, attendee_id, status, qr_code, used_at, attendee:profiles!attendee_id(full_name, avatar_url)").eq("event_id", eventId).in("status", ["valid", "used"]).order("created_at").limit(1000);
  if (error) throw error;
  type R = { id: string; attendee_id: string; status: TicketStatus; qr_code: string | null; used_at: string | null; attendee: { full_name: string; avatar_url: string | null } | { full_name: string; avatar_url: string | null }[] | null };
  return ((data ?? []) as unknown as R[]).map((r) => {
    const a = Array.isArray(r.attendee) ? r.attendee[0] : r.attendee;
    return { ticketId: r.id, userId: r.attendee_id, name: a?.full_name ?? "Participant", avatarUrl: a?.avatar_url ?? null, status: r.status, code: r.qr_code, usedAt: r.used_at };
  });
}

export function useAttendees(eventId: string, enabled: boolean) {
  return useQuery({ queryKey: ["events", "attendees", eventId], queryFn: () => fetchAttendees(eventId), enabled: enabled && getSupabase() !== null && isUuid(eventId), staleTime: 5_000 });
}

/** Contrôle un billet : la base verrouille la ligne, donc deux scans simultanés ne passent jamais tous les deux. */
export async function scanTicket(eventId: string, code: string): Promise<CheckResult> {
  const { data, error } = await requireSupabase().rpc("scan_ticket", { p_qr_code: code.trim(), p_event_id: eventId });
  if (error) throw error;
  return data as CheckResult;
}

export function useScan(eventId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (code: string) => scanTicket(eventId, code), onSuccess: () => qc.invalidateQueries({ queryKey: ["events", "attendees", eventId] }) });
}

/** Jeton d'un billet : 48 caractères hexadécimaux ; le préfixe permet de reconnaître un billet CampusMarket au scan. */
export const TICKET_PREFIX = "CMT:";
export const ticketPayload = (code: string) => `${TICKET_PREFIX}${code}`;
export function codeFromScan(text: string): string {
  const t = text.trim();
  return t.toUpperCase().startsWith(TICKET_PREFIX) ? t.slice(TICKET_PREFIX.length).trim().toLowerCase() : t.toLowerCase();
}
