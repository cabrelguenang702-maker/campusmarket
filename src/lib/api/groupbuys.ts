import { useQuery } from "@tanstack/react-query";
import type { Product } from "../domain";
import { displayStatus, type GroupBuy } from "../groupbuy-model";
import { getSupabase, requireSupabase } from "../supabase";
import { fetchProductsByIds } from "./products";

/* Achats groupés (lecture). La participation (rejoindre, payer) n'est pas encore branchée : la base refuse toute création
 * de participant par le client (0048) ; elle passera par une fonction contrôlée après paiement confirmé. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT = "id, product_id, target_participants, ends_at, status, participant_count, tiers:group_purchase_tiers(min_participants, unit_price)";
type Row = {
  id: string; product_id: string; target_participants: number; ends_at: string; status: "active" | "reached" | "expired" | "cancelled";
  participant_count: number; tiers: { min_participants: number; unit_price: number }[] | null;
};

function toGroupBuy(r: Row): GroupBuy | null {
  const status = displayStatus(r);
  if (status === "annule") return null;
  return {
    id: r.id, productId: r.product_id, target: r.target_participants, joined: r.participant_count, endsAt: r.ends_at, status,
    tiers: [...(r.tiers ?? [])].sort((a, b) => a.min_participants - b.min_participants).map((t) => ({ qty: t.min_participants, price: t.unit_price })),
  };
}

export type GroupBuyWithProduct = { group: GroupBuy; product: Product };

/** Achats groupés en cours (actifs ou complets), les plus proches de l'échéance d'abord ; les groupes expirés ne sont pas listés. */
export async function fetchGroupBuys(): Promise<GroupBuyWithProduct[]> {
  const { data, error } = await requireSupabase().from("group_purchases").select(SELECT).in("status", ["active", "reached"]).order("ends_at", { ascending: true }).limit(60);
  if (error) throw error;
  const groups = ((data ?? []) as unknown as Row[]).map(toGroupBuy).filter((g): g is GroupBuy => g !== null && g.status !== "expire");
  if (groups.length === 0) return [];
  const products = await fetchProductsByIds([...new Set(groups.map((g) => g.productId))]);
  const byId = new Map(products.map((p) => [p.id, p]));
  return groups.flatMap((group) => {
    const product = byId.get(group.productId);
    return product ? [{ group, product }] : [];
  });
}

/** L'achat groupé d'une annonce : le groupe en cours, sinon le plus récent. Null si l'annonce n'en a jamais eu. */
export async function fetchGroupBuyForProduct(productId: string): Promise<GroupBuy | null> {
  if (!UUID.test(productId)) return null;
  const { data, error } = await requireSupabase().from("group_purchases").select(SELECT).eq("product_id", productId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(5);
  if (error) throw error;
  const groups = ((data ?? []) as unknown as Row[]).map(toGroupBuy).filter((g): g is GroupBuy => g !== null);
  return groups.find((g) => g.status === "actif") ?? groups.find((g) => g.status === "complet") ?? groups[0] ?? null;
}

export type GroupParticipant = { userId: string; name: string; avatarUrl: string | null; joinedAt: string };

/** Liste des participants : la base ne la montre qu'aux participants eux-mêmes, au vendeur organisateur et au personnel. */
export async function fetchGroupParticipants(groupId: string): Promise<GroupParticipant[]> {
  const { data, error } = await requireSupabase().from("group_purchase_participants").select("buyer_id, joined_at, buyer:profiles!buyer_id(full_name, avatar_url)").eq("group_purchase_id", groupId).order("joined_at").limit(200);
  if (error) throw error;
  type P = { buyer_id: string; joined_at: string; buyer: { full_name: string; avatar_url: string | null } | { full_name: string; avatar_url: string | null }[] | null };
  return ((data ?? []) as unknown as P[]).map((r) => {
    const b = Array.isArray(r.buyer) ? r.buyer[0] : r.buyer;
    return { userId: r.buyer_id, name: b?.full_name ?? "Étudiant", avatarUrl: b?.avatar_url ?? null, joinedAt: r.joined_at };
  });
}

export function useGroupBuys() {
  return useQuery({ queryKey: ["groupbuys", "list"], queryFn: fetchGroupBuys, enabled: getSupabase() !== null, staleTime: 30_000 });
}
export function useGroupBuyForProduct(productId: string) {
  return useQuery({ queryKey: ["groupbuys", "product", productId], queryFn: () => fetchGroupBuyForProduct(productId), enabled: getSupabase() !== null, staleTime: 15_000 });
}
export function useGroupParticipants(groupId: string | undefined) {
  return useQuery({ queryKey: ["groupbuys", "participants", groupId], queryFn: () => fetchGroupParticipants(groupId!), enabled: !!groupId && getSupabase() !== null, staleTime: 15_000 });
}
