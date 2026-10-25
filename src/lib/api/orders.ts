import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { timeAgo } from "../domain";
import { UserFacingError } from "./errors";

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
    review: useMutation({ mutationFn: submitSellerReview, onSuccess: () => { void qc.invalidateQueries({ queryKey: ["orders"] }); void qc.invalidateQueries({ queryKey: ["seller"] }); void qc.invalidateQueries({ queryKey: ["seller-reviews"] }); } }),
  };
}


/* ---------- Historique, litiges, reçu, tableau vendeur (migration 0059) ---------- */

const ORDER_ERRORS: Record<string, string> = {
  forbidden: "Action non autorisée avec votre compte.", not_found: "Commande introuvable.", not_disputable: "Cette commande ne peut pas (ou plus) faire l'objet d'un litige.",
  invalid_reason: "Choisissez un motif.", invalid_description: "Décrivez le problème en 10 à 2 000 caractères.", invalid_evidence: "Les pièces jointes doivent être des fichiers que vous avez déposés (5 maximum).",
  already_disputed: "Un litige existe déjà pour cette commande.", already_resolved: "Ce litige est déjà tranché.", already_responded: "Vous avez déjà répondu à ce litige.",
  invalid_response: "Votre réponse doit faire entre 10 et 2 000 caractères.", not_paid: "Aucun paiement confirmé pour cette commande : pas de reçu.",
  invalid_outcome: "Décision invalide.", note_required: "Rédigez une justification (5 à 1 000 caractères).", conflict_of_interest: "Vous ne pouvez pas trancher un litige qui vous concerne.",
  no_refund_due: "Aucun remboursement n'est à effectuer pour ce litige.",
};
type Rpc = { success?: boolean; error?: string; [k: string]: unknown };
async function rpc(fn: string, args: Record<string, unknown>): Promise<Rpc> {
  const { data, error } = await requireSupabase().rpc(fn, args);
  if (error) throw error;
  const r = (data ?? {}) as Rpc;
  if (!r.success) throw new UserFacingError(ORDER_ERRORS[r.error ?? ""] ?? "L'action n'a pas pu aboutir.");
  return r;
}

export type DisputeReason = "not_received" | "not_as_described" | "damaged" | "no_show" | "other";
export const DISPUTE_REASON_LABEL: Record<DisputeReason, string> = {
  not_received: "Article non reçu", not_as_described: "Article non conforme à l'annonce", damaged: "Article endommagé", no_show: "Le vendeur ne s'est pas présenté", other: "Autre problème",
};
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Commande créée · en attente de paiement", paid: "Paiement reçu", confirmed: "Remise confirmée par le vendeur", completed: "Réception confirmée · terminée", cancelled: "Annulée", disputed: "Litige ouvert",
};

export type OrderEvent = { status: OrderStatus; at: string };
export function useOrderHistory(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["order-history", orderId], enabled: getSupabase() !== null && enabled,
    queryFn: async (): Promise<OrderEvent[]> => {
      const { data, error } = await requireSupabase().from("order_events").select("status, created_at").eq("order_id", orderId).order("created_at");
      if (error) throw error;
      return ((data ?? []) as { status: OrderStatus; created_at: string }[]).map((e) => ({ status: e.status, at: e.created_at }));
    },
  });
}

export type Dispute = {
  id: string; reason: DisputeReason; description: string; evidence: string[]; sellerResponse: string | null; status: "open" | "resolved_buyer" | "resolved_seller";
  resolutionNote: string | null; refundStatus: "none" | "due" | "done"; createdAt: string;
};
export function useOrderDispute(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["order-dispute", orderId], enabled: getSupabase() !== null && enabled,
    queryFn: async (): Promise<Dispute | null> => {
      const { data, error } = await requireSupabase().from("order_disputes").select("id, reason, description, evidence_paths, seller_response, status, resolution_note, refund_status, created_at").eq("order_id", orderId).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const d = data as { id: string; reason: DisputeReason; description: string; evidence_paths: string[]; seller_response: string | null; status: Dispute["status"]; resolution_note: string | null; refund_status: Dispute["refundStatus"]; created_at: string };
      return { id: d.id, reason: d.reason, description: d.description, evidence: d.evidence_paths, sellerResponse: d.seller_response, status: d.status, resolutionNote: d.resolution_note, refundStatus: d.refund_status, createdAt: d.created_at };
    },
  });
}

export async function evidenceUrl(path: string): Promise<string> {
  const { data, error } = await requireSupabase().storage.from("dispute-evidence").createSignedUrl(path, 600);
  if (error || !data) throw new UserFacingError("Impossible d'ouvrir cette pièce jointe.");
  return data.signedUrl;
}

export function useDisputeActions(userId: string | undefined) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["orders"] }), qc.invalidateQueries({ queryKey: ["order"] }), qc.invalidateQueries({ queryKey: ["order-dispute"] }), qc.invalidateQueries({ queryKey: ["order-history"] })]);
  return {
    open: useMutation({
      mutationFn: async (v: { orderId: string; reason: DisputeReason; description: string; files: File[] }) => {
        if (v.files.length > 3) throw new UserFacingError("Vous pouvez joindre 3 fichiers au maximum.");
        const sb = requireSupabase();
        const paths: string[] = [];
        for (const f of v.files) {
          if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(f.type)) throw new UserFacingError("Formats acceptés : JPG, PNG, WebP ou PDF.");
          if (f.size > 5 * 1024 * 1024) throw new UserFacingError("Chaque fichier doit faire 5 Mo au maximum.");
          const path = `${userId}/${Date.now()}-${paths.length}-${f.name.replace(/[^\w.-]/g, "_")}`;
          const { error } = await sb.storage.from("dispute-evidence").upload(path, f, { contentType: f.type });
          if (error) throw error;
          paths.push(path);
        }
        await rpc("open_order_dispute", { p_order_id: v.orderId, p_reason: v.reason, p_description: v.description, p_evidence: paths });
      },
      onSuccess: refresh,
    }),
    respond: useMutation({ mutationFn: (v: { disputeId: string; text: string }) => rpc("respond_order_dispute", { p_dispute_id: v.disputeId, p_response: v.text }), onSuccess: refresh }),
  };
}

export type Receipt = { number: string; orderId: string; orderedAt: string; paidAt: string; product: string; quantity: number; unitPrice: number; serviceFee: number; total: number; currency: string; buyer: string; seller: string; status: OrderStatus; viewerIsBuyer: boolean };
export function useReceipt(orderId: string) {
  return useQuery({
    queryKey: ["receipt", orderId], enabled: getSupabase() !== null, retry: false,
    queryFn: async (): Promise<Receipt> => {
      const r = (await rpc("order_receipt", { p_order_id: orderId }))["receipt"] as Record<string, unknown>;
      return { number: r["number"] as string, orderId: r["order_id"] as string, orderedAt: r["ordered_at"] as string, paidAt: r["paid_at"] as string, product: (r["product"] as string | null) ?? "Annonce supprimée", quantity: r["quantity"] as number, unitPrice: r["unit_price"] as number, serviceFee: (r["service_fee"] as number | null) ?? 0, total: r["total"] as number, currency: r["currency"] as string, buyer: r["buyer"] as string, seller: r["seller"] as string, status: r["status"] as OrderStatus, viewerIsBuyer: r["viewer_is_buyer"] as boolean };
    },
  });
}

export type SellerFinance = {
  totals: { completed: number; pending: number; disputed: number; last30: number; ordersTotal: number; ordersCompleted: number; ordersPending: number; ordersCancelled: number; ordersDisputed: number };
  monthly: { month: string; amount: number }[]; top: { product: string | null; amount: number; units: number }[];
};
export function useSellerFinance(userId: string | undefined) {
  return useQuery({
    queryKey: ["seller-finance", userId], enabled: getSupabase() !== null && !!userId,
    queryFn: async (): Promise<SellerFinance> => {
      const r = await rpc("seller_finance_summary", {});
      const t = r["totals"] as Record<string, number>;
      return {
        totals: { completed: t["completed"] ?? 0, pending: t["pending"] ?? 0, disputed: t["disputed"] ?? 0, last30: t["last30"] ?? 0, ordersTotal: t["orders_total"] ?? 0, ordersCompleted: t["orders_completed"] ?? 0, ordersPending: t["orders_pending"] ?? 0, ordersCancelled: t["orders_cancelled"] ?? 0, ordersDisputed: t["orders_disputed"] ?? 0 },
        monthly: r["monthly"] as SellerFinance["monthly"], top: r["top_products"] as SellerFinance["top"],
      };
    },
  });
}

/* ---------- Administration des litiges ---------- */
export type AdminDispute = {
  id: string; orderId: string; reason: DisputeReason; description: string; evidence: string[]; sellerResponse: string | null; status: Dispute["status"]; resolutionNote: string | null;
  refundStatus: Dispute["refundStatus"]; createdAt: string; resolvedAt: string | null; product: string | null; quantity: number; total: number; buyer: string | null; seller: string | null;
};
export type DisputeFilter = "open" | "resolved" | "refund" | "all";
export function useAdminDisputes(filter: DisputeFilter) {
  return useQuery({
    queryKey: ["admin-disputes", filter], enabled: getSupabase() !== null,
    queryFn: async (): Promise<AdminDispute[]> => {
      const r = await rpc("admin_list_disputes", { p_status: filter });
      return ((r["items"] ?? []) as Record<string, unknown>[]).map((d) => ({
        id: d["id"] as string, orderId: d["order_id"] as string, reason: d["reason"] as DisputeReason, description: d["description"] as string, evidence: (d["evidence"] as string[]) ?? [],
        sellerResponse: (d["seller_response"] as string | null) ?? null, status: d["status"] as Dispute["status"], resolutionNote: (d["resolution_note"] as string | null) ?? null,
        refundStatus: d["refund_status"] as Dispute["refundStatus"], createdAt: d["created_at"] as string, resolvedAt: (d["resolved_at"] as string | null) ?? null,
        product: (d["product"] as string | null) ?? null, quantity: d["quantity"] as number, total: d["total"] as number, buyer: (d["buyer"] as string | null) ?? null, seller: (d["seller"] as string | null) ?? null,
      }));
    },
  });
}
export function useAdminDisputeActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-disputes"] });
  return {
    resolve: useMutation({ mutationFn: (v: { id: string; outcome: "buyer" | "seller"; note: string }) => rpc("admin_resolve_dispute", { p_dispute_id: v.id, p_outcome: v.outcome, p_note: v.note }), onSuccess: refresh }),
    refunded: useMutation({ mutationFn: (id: string) => rpc("admin_mark_dispute_refunded", { p_dispute_id: id }), onSuccess: refresh }),
  };
}
