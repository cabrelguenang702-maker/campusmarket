import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";

/* Interactions entre membres autour d'une annonce ou d'un profil : offres, signalements, conversations.
 * Tout passe par les tables sous RLS (offers, reports, conversations) : la base décide de ce qui est permis. */

export type OfferStatus = "pending" | "countered" | "accepted" | "rejected" | "withdrawn" | "expired";

export type Offer = {
  id: string;
  productId: string;
  sellerId: string;
  amount: number;
  message: string | null;
  counterAmount: number | null;
  counterMessage: string | null;
  status: OfferStatus;
  orderId: string | null;
  expiresAt: string | null;
};

type OfferRow = {
  id: string; product_id: string; seller_id: string; amount: number; message: string | null;
  counter_amount: number | null; counter_message: string | null; status: OfferStatus; order_id: string | null; expires_at: string | null;
};

const OFFER_COLUMNS = "id, product_id, seller_id, amount, message, counter_amount, counter_message, status, order_id, expires_at";

function mapOffer(r: OfferRow): Offer {
  return {
    id: r.id, productId: r.product_id, sellerId: r.seller_id, amount: r.amount, message: r.message,
    counterAmount: r.counter_amount, counterMessage: r.counter_message, status: r.status, orderId: r.order_id, expiresAt: r.expires_at,
  };
}

/** Dernière offre de l'acheteur sur cette annonce encore ouverte (en attente, contre-proposée ou acceptée). */
export async function fetchMyOpenOffer(buyerId: string, productId: string): Promise<Offer | null> {
  const { data, error } = await requireSupabase()
    .from("offers")
    .select(OFFER_COLUMNS)
    .eq("buyer_id", buyerId)
    .eq("product_id", productId)
    .in("status", ["pending", "countered", "accepted"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const offer = mapOffer(data as OfferRow);
  // Une contre-proposition ou une offre en attente dont le délai est dépassé n'est plus utilisable.
  if (offer.status !== "accepted" && offer.expiresAt && new Date(offer.expiresAt).getTime() < Date.now()) return null;
  return offer;
}

export async function createOffer(input: { buyerId: string; sellerId: string; productId: string; amount: number; message: string }): Promise<void> {
  const { error } = await requireSupabase().from("offers").insert({
    buyer_id: input.buyerId,
    seller_id: input.sellerId,
    product_id: input.productId,
    amount: input.amount,
    message: input.message.trim() || null,
  });
  if (error) throw error;
}

/** Met à jour une offre et vérifie qu'une ligne a bien changé : une policy RLS qui refuse ne renvoie pas d'erreur, juste 0 ligne. */
async function setOfferStatus(offerId: string, status: "accepted" | "withdrawn"): Promise<void> {
  const { data, error } = await requireSupabase().from("offers").update({ status }).eq("id", offerId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("L'offre n'est plus modifiable (elle a peut-être expiré ou changé d'état).");
}

export const acceptCounterOffer = (offerId: string) => setOfferStatus(offerId, "accepted");
export const withdrawOffer = (offerId: string) => setOfferStatus(offerId, "withdrawn");

/* ---------- Signalements ---------- */

export type ReportTarget = "profile" | "product" | "message" | "comment" | "space" | "course" | "post";

export const reportReasons: { id: string; label: string }[] = [
  { id: "spam", label: "Spam ou publicité" },
  { id: "fraude", label: "Arnaque ou fraude" },
  { id: "contenu", label: "Contenu inapproprié" },
  { id: "interdit", label: "Article ou service interdit" },
  { id: "harcelement", label: "Harcèlement ou comportement abusif" },
  { id: "autre", label: "Autre motif" },
];

export async function submitReport(input: { reporterId: string; targetType: ReportTarget; targetId: string; reason: string; details: string }): Promise<void> {
  const { error } = await requireSupabase().from("reports").insert({
    reporter_id: input.reporterId,
    target_type: input.targetType,
    target_id: input.targetId,
    reason: input.reason,
    details: input.details.trim() || null,
  });
  if (error) throw error;
}

/* ---------- Conversations ---------- */

/** Conversation existante avec ce membre (pour cette annonce si précisée), sinon création. Renvoie son identifiant. */
export async function findOrCreateConversation(userId: string, otherId: string, productId?: string): Promise<string> {
  const sb = requireSupabase();
  const lookup = async () => {
    let q = sb
      .from("conversations")
      .select("id")
      .or(`and(participant_one.eq.${userId},participant_two.eq.${otherId}),and(participant_one.eq.${otherId},participant_two.eq.${userId})`);
    q = productId ? q.eq("product_id", productId) : q.is("product_id", null);
    const { data, error } = await q.limit(1).maybeSingle();
    if (error) throw error;
    return (data as { id: string } | null)?.id ?? null;
  };

  const existing = await lookup();
  if (existing) return existing;

  const { data, error } = await sb
    .from("conversations")
    .insert({ participant_one: userId, participant_two: otherId, product_id: productId ?? null })
    .select("id")
    .single();
  if (error) {
    // Course entre deux onglets : l'autre insertion a gagné, on la retrouve.
    if (error.code === "23505") {
      const again = await lookup();
      if (again) return again;
    }
    // Refus de la base : destinataire qui n'accepte pas les messages d'inconnus, compte désactivé, blocage ou restriction.
    // Message volontairement neutre (on ne révèle pas un blocage). Code P0001 : friendlyError l'affiche tel quel.
    if (error.code === "42501") throw Object.assign(new Error("Vous ne pouvez pas écrire à cette personne pour le moment."), { code: "P0001" });
    throw error;
  }
  return (data as { id: string }).id;
}

/* ---------- Alerte « me prévenir si disponible » ---------- */

export async function hasProductAlert(userId: string, productId: string): Promise<boolean> {
  const { data, error } = await requireSupabase().from("product_alerts").select("product_id").eq("user_id", userId).eq("product_id", productId).maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function setProductAlert(userId: string, productId: string, on: boolean): Promise<void> {
  const sb = requireSupabase();
  if (on) {
    const { error } = await sb.from("product_alerts").insert({ user_id: userId, product_id: productId });
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await sb.from("product_alerts").delete().eq("user_id", userId).eq("product_id", productId);
    if (error) throw error;
  }
}

/* ---------- Hooks ---------- */

export function useMyOpenOffer(userId: string | undefined, productId: string) {
  return useQuery({
    queryKey: ["my-offer", productId, userId],
    queryFn: () => fetchMyOpenOffer(userId!, productId),
    enabled: !!userId && getSupabase() !== null,
    staleTime: 15_000,
  });
}

export function useProductAlert(userId: string | undefined, productId: string) {
  const qc = useQueryClient();
  const key = ["product-alert", productId, userId];
  const query = useQuery({ queryKey: key, queryFn: () => hasProductAlert(userId!, productId), enabled: !!userId && getSupabase() !== null, staleTime: 60_000 });
  const toggle = useMutation({
    mutationFn: (on: boolean) => setProductAlert(userId!, productId, on),
    onSuccess: (_d, on) => qc.setQueryData(key, on),
  });
  return { active: query.data ?? false, loading: query.isLoading, toggle };
}

/* ---------- Offres reçues (côté vendeur) ---------- */

export type ReceivedOffer = {
  id: string; productId: string; productName: string; price: number; buyerId: string; buyer: string; amount: number; message: string | null;
  status: "pending" | "countered"; counterAmount: number | null; expiresAt: string | null;
};

export async function fetchReceivedOffers(sellerId: string): Promise<ReceivedOffer[]> {
  const { data, error } = await requireSupabase()
    .from("offers")
    .select("id, product_id, buyer_id, amount, message, status, counter_amount, expires_at, product:products!product_id(name, price), buyer:profiles!buyer_id(full_name)")
    .eq("seller_id", sellerId)
    .in("status", ["pending", "countered"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  type R = { id: string; product_id: string; buyer_id: string; amount: number; message: string | null; status: "pending" | "countered"; counter_amount: number | null; expires_at: string | null;
    product: { name: string; price: number } | { name: string; price: number }[] | null; buyer: { full_name: string } | { full_name: string }[] | null };
  return ((data ?? []) as unknown as R[])
    .filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > Date.now())
    .map((r) => {
      const product = Array.isArray(r.product) ? r.product[0] : r.product;
      const buyer = Array.isArray(r.buyer) ? r.buyer[0] : r.buyer;
      return { id: r.id, productId: r.product_id, productName: product?.name ?? "Annonce", price: product?.price ?? 0, buyerId: r.buyer_id, buyer: buyer?.full_name ?? "Membre", amount: r.amount, message: r.message, status: r.status, counterAmount: r.counter_amount, expiresAt: r.expires_at };
    });
}

async function sellerUpdateOffer(offerId: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await requireSupabase().from("offers").update(patch).eq("id", offerId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Cette offre n'est plus modifiable (expirée ou déjà traitée).");
}
export const acceptOffer = (id: string) => sellerUpdateOffer(id, { status: "accepted" });
export const rejectOffer = (id: string) => sellerUpdateOffer(id, { status: "rejected" });
export const counterOffer = (id: string, amount: number, message: string) => sellerUpdateOffer(id, { status: "countered", counter_amount: amount, counter_message: message.trim() || null });

export function useReceivedOffers(sellerId: string | undefined) {
  return useQuery({ queryKey: ["received-offers", sellerId], queryFn: () => fetchReceivedOffers(sellerId!), enabled: !!sellerId && getSupabase() !== null, staleTime: 15_000 });
}

export function useOfferResponses() {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["received-offers"] }); void qc.invalidateQueries({ queryKey: ["orders"] }); void qc.invalidateQueries({ queryKey: ["product"] }); };
  return {
    accept: useMutation({ mutationFn: acceptOffer, onSuccess: refresh }),
    reject: useMutation({ mutationFn: rejectOffer, onSuccess: refresh }),
    counter: useMutation({ mutationFn: (v: { id: string; amount: number; message: string }) => counterOffer(v.id, v.amount, v.message), onSuccess: refresh }),
  };
}
