import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { timeAgo } from "../domain";

/* Commandes de la marketplace. Le client n'envoie que product_id, quantity, idempotency_key, lieu et message :
 * prix, frais, vendeur, réservation du stock et statut sont fixés par la base (migration 0034). */

export type OrderStatus = "pending_payment" | "paid" | "confirmed" | "completed" | "cancelled" | "disputed";

export type Order = {
  id: string;
  productId: string;
  productName: string;
  productCategory: string;
  buyerId: string;
  sellerId: string;
  counterpart: string;
  quantity: number;
  unitPrice: number;
  serviceFee: number;
  total: number;
  status: OrderStatus;
  meetingPoint: string | null;
  note: string | null;
  cancelReason: string | null;
  date: string;
  createdAt: string;
  /** Fin de la réservation de stock (commande en attente de paiement). */
  reservedUntil: string | null;
  reviewed: boolean;
};

type Row = {
  id: string; product_id: string; buyer_id: string; seller_id: string; quantity: number; unit_price: number; service_fee: number | null; total_amount: number;
  status: OrderStatus; meeting_point: string | null; buyer_note: string | null; cancel_reason: string | null; created_at: string;
  product: { name: string; category_slug: string } | { name: string; category_slug: string }[] | null;
  buyer: { full_name: string } | { full_name: string }[] | null;
  seller: { full_name: string } | { full_name: string }[] | null;
  reservation: { expires_at: string; status: string } | { expires_at: string; status: string }[] | null;
  review: { id: string }[] | null;
};

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

const COLUMNS =
  "id, product_id, buyer_id, seller_id, quantity, unit_price, service_fee, total_amount, status, meeting_point, buyer_note, cancel_reason, created_at, " +
  "product:products!product_id(name, category_slug), buyer:profiles!buyer_id(full_name), seller:profiles!seller_id(full_name), " +
  "reservation:reservations!reservation_id(expires_at, status), review:seller_reviews!order_id(id)";

function map(r: Row, viewerId: string): Order {
  const product = one(r.product);
  const buyer = one(r.buyer);
  const seller = one(r.seller);
  const reservation = one(r.reservation);
  const iAmBuyer = r.buyer_id === viewerId;
  return {
    id: r.id, productId: r.product_id, productName: product?.name ?? "Annonce supprimée", productCategory: product?.category_slug ?? "ordinateurs",
    buyerId: r.buyer_id, sellerId: r.seller_id, counterpart: (iAmBuyer ? seller?.full_name : buyer?.full_name) ?? "Membre", quantity: r.quantity,
    unitPrice: r.unit_price, serviceFee: r.service_fee ?? 0, total: r.total_amount, status: r.status, meetingPoint: r.meeting_point, note: r.buyer_note,
    cancelReason: r.cancel_reason, date: timeAgo(r.created_at), createdAt: r.created_at,
    reservedUntil: reservation && reservation.status === "active" ? reservation.expires_at : null,
    reviewed: (r.review ?? []).length > 0,
  };
}

export async function fetchMyOrders(userId: string, role: "buyer" | "seller"): Promise<Order[]> {
  const { data, error } = await requireSupabase()
    .from("orders")
    .select(COLUMNS)
    .eq(role === "buyer" ? "buyer_id" : "seller_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map((r) => map(r, userId));
}

export async function fetchOrder(orderId: string, viewerId: string): Promise<Order | null> {
  const { data, error } = await requireSupabase().from("orders").select(COLUMNS).eq("id", orderId).maybeSingle();
  if (error) throw error;
  return data ? map(data as unknown as Row, viewerId) : null;
}

/** Commande en attente de paiement de cet acheteur pour cette annonce (reprise d'un achat commencé, ou offre acceptée). */
export async function fetchMyPendingOrder(userId: string, productId: string): Promise<Order | null> {
  const { data, error } = await requireSupabase()
    .from("orders")
    .select(COLUMNS)
    .eq("buyer_id", userId)
    .eq("product_id", productId)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? map(data as unknown as Row, userId) : null;
}

export async function createOrder(input: { userId: string; productId: string; quantity: number; meetingPoint: string; note: string; idempotencyKey: string; groupPurchaseId?: string | undefined }): Promise<Order> {
  const sb = requireSupabase();
  // seller_id, unit_price, service_fee, total_amount, reservation_id : valeurs provisoires, remplacées par la base.
  const { data, error } = await sb
    .from("orders")
    .insert({
      idempotency_key: input.idempotencyKey, product_id: input.productId, buyer_id: input.userId, seller_id: input.userId,
      quantity: input.quantity, unit_price: 0, total_amount: 0, status: "pending_payment",
      meeting_point: input.meetingPoint || null, buyer_note: input.note.trim() || null,
      ...(input.groupPurchaseId ? { group_purchase_id: input.groupPurchaseId } : {}),
    })
    .select("id")
    .single();
  let orderId = (data as { id: string } | null)?.id;
  if (error) {
    // Relance du même clic (réseau coupé après l'insertion) : la commande existe déjà, on la retrouve par sa clé.
    if (error.code !== "23505") throw error;
    const existing = await sb.from("orders").select("id").eq("idempotency_key", input.idempotencyKey).eq("buyer_id", input.userId).maybeSingle();
    if (existing.error || !existing.data) throw error;
    orderId = (existing.data as { id: string }).id;
  }
  const order = await fetchOrder(orderId!, input.userId);
  if (!order) throw new Error("Commande introuvable après création.");
  return order;
}

async function setStatus(orderId: string, status: OrderStatus, extra: Record<string, unknown> = {}): Promise<void> {
  const { data, error } = await requireSupabase().from("orders").update({ status, ...extra }).eq("id", orderId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Cette commande n'est plus modifiable.");
}

export const cancelOrder = (orderId: string, reason = "buyer_cancelled") => setStatus(orderId, "cancelled", { cancel_reason: reason });
export const confirmHandover = (orderId: string) => setStatus(orderId, "confirmed");
export const confirmReceipt = (orderId: string) => setStatus(orderId, "completed");
export const openDispute = (orderId: string) => setStatus(orderId, "disputed");

/* ---------- Avis sur le vendeur ---------- */

export async function submitSellerReview(input: { orderId: string; sellerId: string; reviewerId: string; rating: number; body: string }): Promise<void> {
  const { error } = await requireSupabase().from("seller_reviews").insert({
    order_id: input.orderId, seller_id: input.sellerId, reviewer_id: input.reviewerId, rating: input.rating, body: input.body.trim() || null,
  });
  if (error) throw error;
}

/* ---------- Hooks ---------- */

const enabled = () => getSupabase() !== null;

export function useMyOrders(userId: string | undefined, role: "buyer" | "seller") {
  return useQuery({ queryKey: ["orders", role, userId], queryFn: () => fetchMyOrders(userId!, role), enabled: enabled() && !!userId, staleTime: 15_000 });
}

export function useOrder(orderId: string | undefined, viewerId: string | undefined) {
  return useQuery({ queryKey: ["order", orderId], queryFn: () => fetchOrder(orderId!, viewerId!), enabled: enabled() && !!orderId && !!viewerId, staleTime: 5_000 });
}

export function useMyPendingOrder(userId: string | undefined, productId: string) {
  return useQuery({ queryKey: ["pending-order", productId, userId], queryFn: () => fetchMyPendingOrder(userId!, productId), enabled: enabled() && !!userId, staleTime: 0, gcTime: 0 });
}

export function useOrderActions() {
  const qc = useQueryClient();
  const refresh = (orderId: string) => {
    void qc.invalidateQueries({ queryKey: ["orders"] });
    void qc.invalidateQueries({ queryKey: ["order", orderId] });
    void qc.invalidateQueries({ queryKey: ["pending-order"] });
    void qc.invalidateQueries({ queryKey: ["product"] });
    void qc.invalidateQueries({ queryKey: ["listings"] });
  };
  return {
    cancel: useMutation({ mutationFn: (orderId: string) => cancelOrder(orderId), onSuccess: (_d, id) => refresh(id) }),
    handover: useMutation({ mutationFn: confirmHandover, onSuccess: (_d, id) => refresh(id) }),
    receive: useMutation({ mutationFn: confirmReceipt, onSuccess: (_d, id) => refresh(id) }),
    dispute: useMutation({ mutationFn: openDispute, onSuccess: (_d, id) => refresh(id) }),
    review: useMutation({ mutationFn: submitSellerReview, onSuccess: () => { void qc.invalidateQueries({ queryKey: ["orders"] }); void qc.invalidateQueries({ queryKey: ["seller"] }); void qc.invalidateQueries({ queryKey: ["seller-reviews"] }); } }),
  };
}
