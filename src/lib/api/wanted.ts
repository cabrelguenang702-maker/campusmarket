import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { timeAgo, type CategorySlug } from "../domain";

/* Demandes « Je recherche » : tables wanted_requests / wanted_responses (migration 0022).
 * Les compteurs (responses_count) sont tenus par trigger : le client ne les écrit jamais. */

export type WantedStatus = "open" | "fulfilled" | "closed";

export type WantedRequest = {
  id: string;
  authorId: string;
  author: string;
  authorAvatarUrl: string | null;
  title: string;
  description: string;
  budget: number;
  category: CategorySlug;
  campus: string;
  city: string;
  posted: string;
  responses: number;
  status: WantedStatus;
};

type Row = {
  id: string; author_id: string; title: string; description: string; budget: number; category_slug: CategorySlug; campus: string; city: string;
  status: WantedStatus; responses_count: number; created_at: string;
  author: { full_name: string; avatar_url: string | null } | { full_name: string; avatar_url: string | null }[] | null;
};

const COLUMNS = "id, author_id, title, description, budget, category_slug, campus, city, status, responses_count, created_at, author:profiles!author_id(full_name, avatar_url)";

function map(r: Row): WantedRequest {
  const author = Array.isArray(r.author) ? r.author[0] : r.author;
  return {
    id: r.id, authorId: r.author_id, author: author?.full_name ?? "Membre", authorAvatarUrl: author?.avatar_url ?? null, title: r.title, description: r.description,
    budget: r.budget, category: r.category_slug, campus: r.campus, city: r.city, posted: timeAgo(r.created_at), responses: r.responses_count, status: r.status,
  };
}

export const WANTED_PAGE_SIZE = 12;

export async function fetchWanted(o: { category?: string | undefined; limit: number; offset: number }): Promise<{ items: WantedRequest[]; total: number }> {
  let q = requireSupabase().from("wanted_requests").select(COLUMNS, { count: "exact" }).in("status", ["open", "fulfilled"]);
  if (o.category) q = q.eq("category_slug", o.category);
  const { data, error, count } = await q.order("created_at", { ascending: false }).range(o.offset, o.offset + o.limit - 1);
  if (error) throw error;
  const items = ((data ?? []) as unknown as Row[]).map(map);
  return { items, total: count ?? items.length };
}

export async function fetchMyWanted(userId: string): Promise<WantedRequest[]> {
  const { data, error } = await requireSupabase().from("wanted_requests").select(COLUMNS).eq("author_id", userId).neq("status", "closed").order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(map);
}

export type NewWanted = { title: string; description: string; budget: number; category: CategorySlug; campus: string; city: string };

export async function createWanted(userId: string, input: NewWanted): Promise<string> {
  const { data, error } = await requireSupabase()
    .from("wanted_requests")
    .insert({
      author_id: userId, title: input.title.trim(), description: input.description.trim() || "Pas de précision supplémentaire.",
      budget: input.budget, category_slug: input.category, campus: input.campus, city: input.city,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** Une ligne doit avoir changé : une policy RLS qui refuse ne lève pas d'erreur, elle ne touche aucune ligne. */
export async function setWantedStatus(id: string, status: WantedStatus): Promise<void> {
  const { data, error } = await requireSupabase().from("wanted_requests").update({ status }).eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Cette demande n'est plus modifiable.");
}

export async function respondToWanted(input: { requestId: string; responderId: string; productId: string | null; message: string }): Promise<void> {
  const { error } = await requireSupabase().from("wanted_responses").insert({
    request_id: input.requestId, responder_id: input.responderId, product_id: input.productId, message: input.message.trim(),
  });
  if (error) throw error;
}

export type WantedResponse = { id: string; responder: string; responderId: string; message: string; posted: string; productId: string | null; productName: string | null };

export async function fetchWantedResponses(requestId: string): Promise<WantedResponse[]> {
  const { data, error } = await requireSupabase()
    .from("wanted_responses")
    .select("id, responder_id, message, created_at, product_id, responder:profiles!responder_id(full_name), product:products!product_id(name)")
    .eq("request_id", requestId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  type R = { id: string; responder_id: string; message: string; created_at: string; product_id: string | null; responder: { full_name: string } | { full_name: string }[] | null; product: { name: string } | { name: string }[] | null };
  return ((data ?? []) as unknown as R[]).map((r) => {
    const who = Array.isArray(r.responder) ? r.responder[0] : r.responder;
    const prod = Array.isArray(r.product) ? r.product[0] : r.product;
    return { id: r.id, responderId: r.responder_id, responder: who?.full_name ?? "Membre", message: r.message, posted: timeAgo(r.created_at), productId: r.product_id, productName: prod?.name ?? null };
  });
}

/* ---------- Hooks ---------- */

const enabled = () => getSupabase() !== null;

export function useWanted(category: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["wanted", category ?? ""],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchWanted({ category, limit: WANTED_PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total && last.items.length > 0 ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
    enabled: enabled(),
    staleTime: 30_000,
  });
}

export function useMyWanted(userId: string | undefined) {
  return useQuery({ queryKey: ["my-wanted", userId], queryFn: () => fetchMyWanted(userId!), enabled: enabled() && !!userId, staleTime: 30_000 });
}

export function useWantedResponses(requestId: string | undefined) {
  return useQuery({ queryKey: ["wanted-responses", requestId], queryFn: () => fetchWantedResponses(requestId!), enabled: enabled() && !!requestId, staleTime: 15_000 });
}

export function useWantedMutations() {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["wanted"] }); void qc.invalidateQueries({ queryKey: ["my-wanted"] }); };
  return {
    create: useMutation({ mutationFn: ({ userId, input }: { userId: string; input: NewWanted }) => createWanted(userId, input), onSuccess: refresh }),
    setStatus: useMutation({ mutationFn: ({ id, status }: { id: string; status: WantedStatus }) => setWantedStatus(id, status), onSuccess: refresh }),
    respond: useMutation({ mutationFn: respondToWanted, onSuccess: refresh }),
  };
}
