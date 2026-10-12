import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import {
  categoryOf,
  conditionFromDb,
  conditionToDb,
  memberSince,
  timeAgo,
  type CategorySlug,
  type Condition,
  type ListingStatus,
  type Product,
  type Seller,
  type Stock,
} from "../domain";
import { PRICE_MAX, defaultFilters, type Filters, type Tri } from "../catalog";

const MEDIA_BUCKET = "product-media";
const SIGNED_URL_TTL = 3600;

/** Ligne de la vue public.marketplace_listings (migration 0025). */
type ListingRow = {
  id: string;
  seller_id: string;
  category_slug: string;
  name: string;
  description: string;
  price: number;
  old_price: number | null;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  condition: string;
  negotiable: boolean;
  campus: string;
  city: string;
  status: ListingStatus;
  views: number;
  created_at: string;
  specs: unknown;
  favorites_count: number;
  seller_name: string;
  seller_campus: string | null;
  seller_city: string | null;
  seller_avatar_url: string | null;
  seller_verified: boolean;
  seller_since: string;
  seller_rating: number;
  seller_reviews: number;
  seller_sales: number;
  expires_at: string | null;
};

type MediaRow = { product_id: string; storage_path: string; position: number };

function stockOf(r: Pick<ListingRow, "status" | "quantity" | "reserved_quantity" | "available_quantity">): Stock {
  if (r.status === "sold") return "sold";
  if (r.status === "archived") return "expired";
  if (r.available_quantity <= 0) return r.reserved_quantity > 0 ? "reserved" : "sold";
  if (r.quantity > 1 && r.available_quantity <= 2) return "low";
  return "available";
}

function parseSpecs(raw: unknown): [string, string][] {
  if (!Array.isArray(raw)) return [];
  const out: [string, string][] = [];
  for (const item of raw) {
    if (Array.isArray(item) && typeof item[0] === "string" && typeof item[1] === "string") out.push([item[0], item[1]]);
  }
  return out;
}

function mapListing(r: ListingRow, images: string[]): Product {
  const category = categoryOf(r.category_slug);
  const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86_400_000);
  return {
    id: r.id,
    name: r.name,
    price: r.price,
    oldPrice: r.old_price ?? undefined,
    campus: r.campus,
    city: r.city,
    condition: conditionFromDb(r.condition),
    status: r.status,
    sellerId: r.seller_id,
    sellerName: r.seller_name,
    sellerCampus: [r.seller_campus, r.seller_city].filter(Boolean).join(" · "),
    sellerVerified: r.seller_verified,
    sellerAvatarUrl: r.seller_avatar_url,
    rating: Number(r.seller_rating),
    reviews: r.seller_reviews,
    posted: timeAgo(r.created_at),
    postedDays: Math.max(0, days),
    stock: stockOf(r),
    icon: category.icon,
    tone: category.tone,
    category: category.slug,
    negotiable: r.negotiable,
    quantity: Math.max(0, r.available_quantity),
    description: r.description,
    specs: parseSpecs(r.specs),
    views: r.views,
    favorites: r.favorites_count,
    images,
    expiresAt: r.expires_at,
  };
}

/** Les photos sont dans un bucket privé : on génère des URLs signées (la policy de lecture de storage s'applique). */
async function imagesByProduct(productIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (productIds.length === 0) return result;
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("product_media")
    .select("product_id, storage_path, position")
    .in("product_id", productIds)
    .order("position", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as MediaRow[];
  if (rows.length === 0) return result;

  const signed = await sb.storage.from(MEDIA_BUCKET).createSignedUrls(
    rows.map((m) => m.storage_path),
    SIGNED_URL_TTL,
  );
  if (signed.error) throw signed.error;
  const urlByPath = new Map<string, string>();
  for (const s of signed.data ?? []) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);

  for (const m of rows) {
    const url = urlByPath.get(m.storage_path);
    if (!url) continue;
    const list = result.get(m.product_id) ?? [];
    list.push(url);
    result.set(m.product_id, list);
  }
  return result;
}

async function toProducts(rows: ListingRow[]): Promise<Product[]> {
  const images = await imagesByProduct(rows.map((r) => r.id));
  return rows.map((r) => mapListing(r, images.get(r.id) ?? []));
}

/** Retire les caractères qui ont un sens dans la syntaxe des filtres PostgREST ou dans un motif ilike. */
function sanitizeSearch(q: string | undefined): string {
  return (q ?? "").replace(/[%_\\,.()*"':;]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Annonces publiées d'un campus (page d'une université) : les plus récentes d'abord, avec le total. */
export async function fetchCampusListings(campus: string, limit = 4): Promise<{ items: Product[]; total: number }> {
  const { data, error, count } = await requireSupabase().from("marketplace_listings").select("*", { count: "exact" }).eq("status", "published").eq("campus", campus).order("created_at", { ascending: false }).range(0, limit - 1);
  if (error) throw error;
  return { items: await toProducts((data ?? []) as ListingRow[]), total: count ?? 0 };
}

export type ListingQuery = {
  q?: string | undefined;
  categorie?: string | undefined;
  filters: Filters;
  tri: Tri;
  limit: number;
  offset: number;
};

export async function fetchListings(o: ListingQuery): Promise<{ items: Product[]; total: number }> {
  const sb = requireSupabase();
  const f = o.filters;
  let query = sb.from("marketplace_listings").select("*", { count: "exact" }).eq("status", "published");

  const term = sanitizeSearch(o.q);
  if (term) query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
  if (o.categorie) query = query.eq("category_slug", o.categorie);
  if (f.min > 0) query = query.gte("price", f.min);
  if (f.max < PRICE_MAX) query = query.lte("price", f.max);
  if (f.etats.length > 0) query = query.in("condition", f.etats.map(conditionToDb));
  if (f.campus !== "tous") query = query.eq("campus", f.campus);
  if (f.dispo) query = query.gt("available_quantity", 0);
  if (f.verifie) query = query.eq("seller_verified", true);
  if (f.negociable) query = query.eq("negotiable", true);
  if (f.noteMin > 0) query = query.gte("seller_rating", f.noteMin);
  if (f.fraicheur !== "tous") {
    query = query.gte("created_at", new Date(Date.now() - Number(f.fraicheur) * 86_400_000).toISOString());
  }

  switch (o.tri) {
    case "recent":
      query = query.order("created_at", { ascending: false });
      break;
    case "prix-asc":
      query = query.order("price", { ascending: true }).order("created_at", { ascending: false });
      break;
    case "prix-desc":
      query = query.order("price", { ascending: false }).order("created_at", { ascending: false });
      break;
    case "note":
      query = query
        .order("seller_rating", { ascending: false })
        .order("seller_reviews", { ascending: false })
        .order("created_at", { ascending: false });
      break;
    default:
      query = query.order("relevance", { ascending: false }).order("created_at", { ascending: false });
  }

  const { data, error, count } = await query.range(o.offset, o.offset + o.limit - 1);
  if (error) throw error;
  const rows = (data ?? []) as ListingRow[];
  return { items: await toProducts(rows), total: count ?? rows.length };
}

/** Une annonce par identifiant (publiée, ou appartenant à l'utilisateur, ou visible du staff : la RLS tranche). */
export async function fetchProduct(id: string): Promise<Product | null> {
  const sb = requireSupabase();
  const { data, error } = await sb.from("marketplace_listings").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [product] = await toProducts([data as ListingRow]);
  return product ?? null;
}

export async function fetchProductsByIds(ids: string[]): Promise<Product[]> {
  if (ids.length === 0) return [];
  const sb = requireSupabase();
  const { data, error } = await sb.from("marketplace_listings").select("*").in("id", ids);
  if (error) throw error;
  return toProducts((data ?? []) as ListingRow[]);
}

/** Annonces de l'utilisateur, tous statuts confondus (brouillons et annonces en revue comprises). */
export async function fetchSellerListings(sellerId: string, opts: { publishedOnly: boolean }): Promise<Product[]> {
  const sb = requireSupabase();
  let query = sb.from("marketplace_listings").select("*").eq("seller_id", sellerId);
  if (opts.publishedOnly) query = query.eq("status", "published");
  const { data, error } = await query.order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return toProducts((data ?? []) as ListingRow[]);
}

/** Annonces qui répondent à une demande « Je recherche » : même catégorie, prix <= budget + 15 %, disponibles. */
export async function fetchMatchingListings(req: { category: string; budget: number; authorId: string }, limit = 12): Promise<Product[]> {
  const { data, error } = await requireSupabase()
    .from("marketplace_listings")
    .select("*")
    .eq("status", "published")
    .eq("category_slug", req.category)
    .lte("price", Math.floor(req.budget * 1.15))
    .gt("available_quantity", 0)
    .neq("seller_id", req.authorId)
    .order("relevance", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return toProducts((data ?? []) as ListingRow[]);
}

/** Même catégorie, hors annonce courante : « Annonces similaires ». */
export async function fetchSimilarListings(product: Pick<Product, "id" | "category">, limit = 4): Promise<Product[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("marketplace_listings")
    .select("*")
    .eq("status", "published")
    .eq("category_slug", product.category)
    .neq("id", product.id)
    .order("relevance", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return toProducts((data ?? []) as ListingRow[]);
}

/** Nombre d'annonces publiées par catégorie (accueil et filtres). */
export async function fetchCategoryCounts(): Promise<Record<string, number>> {
  const sb = requireSupabase();
  const counts: Record<string, number> = {};
  await Promise.all(
    (["telephones", "ordinateurs", "audio", "livres", "services", "mode", "maison"] satisfies CategorySlug[]).map(
      async (slug) => {
        const { count, error } = await sb
          .from("marketplace_listings")
          .select("id", { count: "exact", head: true })
          .eq("status", "published")
          .eq("category_slug", slug);
        if (error) throw error;
        counts[slug] = count ?? 0;
      },
    ),
  );
  return counts;
}

/** Campus ayant au moins une annonce publiée (filtre « Campus » de la marketplace). */
export async function fetchListingCampuses(): Promise<string[]> {
  const sb = requireSupabase();
  const { data, error } = await sb.from("marketplace_listings").select("campus").eq("status", "published").limit(1000);
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((r: { campus: string }) => r.campus))).sort();
}

/** Fourchette de prix des annonces publiées d'une catégorie (aide à la fixation du prix). */
export async function fetchCategoryPriceRange(slug: string): Promise<{ min: number; max: number; count: number } | null> {
  const sb = requireSupabase();
  const base = () => sb.from("marketplace_listings").select("price").eq("status", "published").eq("category_slug", slug);
  const [lo, hi, total] = await Promise.all([
    base().order("price", { ascending: true }).limit(1),
    base().order("price", { ascending: false }).limit(1),
    sb.from("marketplace_listings").select("id", { count: "exact", head: true }).eq("status", "published").eq("category_slug", slug),
  ]);
  if (lo.error) throw lo.error;
  if (hi.error) throw hi.error;
  if (total.error) throw total.error;
  const min = (lo.data as { price: number }[])[0]?.price;
  const max = (hi.data as { price: number }[])[0]?.price;
  if (min === undefined || max === undefined) return null;
  return { min, max, count: total.count ?? 0 };
}

/** Compte une vue (ignorée côté base pour le vendeur lui-même et pour les annonces non publiées). */
export async function recordProductView(productId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc("increment_product_views", { p_product_id: productId });
  if (error) throw error;
}

/* ------------------------------------------------------------------------------------------------
 * Vendeur
 * ------------------------------------------------------------------------------------------------ */

export async function fetchSeller(id: string): Promise<Seller | null> {
  const sb = requireSupabase();
  const [profile, stats, listings] = await Promise.all([
    sb.from("profiles").select("id, full_name, avatar_url, bio, campus, city, verified, created_at").eq("id", id).maybeSingle(),
    sb.from("seller_stats").select("rating_avg, reviews_count, sales_count, followers_count").eq("seller_id", id).maybeSingle(),
    sb.from("marketplace_listings").select("id", { count: "exact", head: true }).eq("seller_id", id).eq("status", "published"),
  ]);
  if (profile.error) throw profile.error;
  if (stats.error) throw stats.error;
  if (listings.error) throw listings.error;
  if (!profile.data) return null;
  const p = profile.data as {
    id: string; full_name: string; avatar_url: string | null; bio: string | null;
    campus: string | null; city: string | null; verified: boolean; created_at: string;
  };
  const s = stats.data as { rating_avg: number; reviews_count: number; sales_count: number; followers_count: number } | null;
  return {
    id: p.id,
    name: p.full_name,
    campus: [p.campus, p.city].filter(Boolean).join(" · "),
    listings: listings.count ?? 0,
    sales: s?.sales_count ?? 0,
    rating: Number(s?.rating_avg ?? 0),
    reviews: s?.reviews_count ?? 0,
    verified: p.verified,
    since: memberSince(p.created_at),
    bio: p.bio ?? undefined,
    avatarUrl: p.avatar_url,
    followers: s?.followers_count ?? 0,
  };
}

export type SellerReview = { id: string; author: string; rating: number; date: string; text: string };

export async function fetchSellerReviews(sellerId: string, limit = 20): Promise<SellerReview[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("seller_reviews")
    .select("id, rating, body, created_at, reviewer:profiles!reviewer_id(full_name)")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  type Row = { id: string; rating: number; body: string | null; created_at: string; reviewer: { full_name: string } | { full_name: string }[] | null };
  return ((data ?? []) as Row[]).map((r) => {
    const reviewer = Array.isArray(r.reviewer) ? r.reviewer[0] : r.reviewer;
    return { id: r.id, author: reviewer?.full_name ?? "Membre", rating: r.rating, date: timeAgo(r.created_at), text: r.body ?? "" };
  });
}

/** Nombre d'avis par note (1 à 5) d'un vendeur, pour la répartition affichée sur sa boutique. */
export async function fetchSellerRatingDistribution(sellerId: string): Promise<Record<1 | 2 | 3 | 4 | 5, number>> {
  const { data, error } = await requireSupabase().from("seller_reviews").select("rating").eq("seller_id", sellerId).limit(5000);
  if (error) throw error;
  const out: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of (data ?? []) as { rating: number }[]) if (r.rating >= 1 && r.rating <= 5) out[r.rating as 1 | 2 | 3 | 4 | 5] += 1;
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Abonnements (« Suivre » un vendeur)
 * ------------------------------------------------------------------------------------------------ */

export async function isFollowing(followerId: string, sellerId: string): Promise<boolean> {
  const { data, error } = await requireSupabase().from("profile_follows").select("followee_id").eq("follower_id", followerId).eq("followee_id", sellerId).maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function setFollowing(followerId: string, sellerId: string, on: boolean): Promise<void> {
  const sb = requireSupabase();
  if (on) {
    const { error } = await sb.from("profile_follows").insert({ follower_id: followerId, followee_id: sellerId });
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await sb.from("profile_follows").delete().eq("follower_id", followerId).eq("followee_id", sellerId);
    if (error) throw error;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Favoris
 * ------------------------------------------------------------------------------------------------ */

export async function fetchFavoriteIds(userId: string): Promise<string[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("product_favorites")
    .select("product_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as { product_id: string }[]).map((r) => r.product_id);
}

export async function addFavorite(userId: string, productId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from("product_favorites").insert({ user_id: userId, product_id: productId });
  // 23505 : déjà en favori (double clic, deux onglets) — l'état voulu est atteint.
  if (error && error.code !== "23505") throw error;
}

export async function removeFavorite(userId: string, productId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from("product_favorites").delete().eq("user_id", userId).eq("product_id", productId);
  if (error) throw error;
}

/* ------------------------------------------------------------------------------------------------
 * Publication
 * ------------------------------------------------------------------------------------------------ */

export type NewListing = {
  name: string;
  description: string;
  price: number;
  oldPrice?: number | undefined;
  quantity: number;
  condition: Condition;
  negotiable: boolean;
  category: CategorySlug;
  campus: string;
  city: string;
  specs: [string, string][];
  /** Durée de visibilité après validation par la modération. */
  durationDays: 15 | 30 | 60;
};

export const MAX_PHOTOS = 6;

function extensionOf(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
}

/**
 * Crée l'annonce en `pending_review` (ou `draft`) puis envoie les photos. Le statut `published` n'est
 * jamais demandé par le client : seule la modération (admin_set_listing_status) publie.
 * Si un envoi de photo échoue, l'annonce existe quand même (sans cette photo) et l'erreur est remontée.
 */
export async function createListing(
  userId: string,
  input: NewListing,
  photos: File[],
  status: "draft" | "pending_review",
): Promise<{ id: string; failedPhotos: number }> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("products")
    .insert({
      seller_id: userId,
      category_slug: input.category,
      name: input.name.trim(),
      description: input.description.trim(),
      price: input.price,
      old_price: input.oldPrice ?? null,
      quantity: input.quantity,
      condition: conditionToDb(input.condition),
      negotiable: input.negotiable,
      campus: input.campus,
      city: input.city,
      specs: input.specs.filter(([k, v]) => k.trim() && v.trim()).slice(0, 12),
      duration_days: input.durationDays,
      status,
    })
    .select("id")
    .single();
  if (error) throw error;
  const productId = (data as { id: string }).id;

  let failed = 0;
  let position = 0;
  for (const file of photos.slice(0, MAX_PHOTOS)) {
    const path = `${userId}/${productId}/${position}-${crypto.randomUUID()}.${extensionOf(file)}`;
    const up = await sb.storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
    if (up.error) { failed += 1; continue; }
    const ins = await sb.from("product_media").insert({ product_id: productId, storage_path: path, position });
    if (ins.error) { failed += 1; await sb.storage.from(MEDIA_BUCKET).remove([path]); continue; }
    position += 1;
  }
  return { id: productId, failedPhotos: failed };
}

export type ProductMedia = { id: string; path: string; url: string };

/** Photos d'une annonce avec leur identifiant (édition) : URLs signées, dans l'ordre d'affichage. */
export async function fetchProductMedia(productId: string): Promise<ProductMedia[]> {
  const sb = requireSupabase();
  const { data, error } = await sb.from("product_media").select("id, storage_path, position").eq("product_id", productId).order("position", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as { id: string; storage_path: string }[];
  if (rows.length === 0) return [];
  const signed = await sb.storage.from(MEDIA_BUCKET).createSignedUrls(rows.map((m) => m.storage_path), SIGNED_URL_TTL);
  if (signed.error) throw signed.error;
  const urlByPath = new Map<string, string>();
  for (const x of signed.data ?? []) if (x.path && x.signedUrl) urlByPath.set(x.path, x.signedUrl);
  return rows.flatMap((m) => { const url = urlByPath.get(m.storage_path); return url ? [{ id: m.id, path: m.storage_path, url }] : []; });
}

/**
 * Met à jour une annonce du vendeur. Le statut repasse toujours à `pending_review` (ou `draft`) : la base interdit au
 * vendeur de modifier une annonce `published` sans la renvoyer en validation, et les photos ne sont modifiables
 * qu'une fois l'annonce sortie de `published` — d'où l'ordre : champs et statut d'abord, photos ensuite.
 */
export async function updateListing(
  userId: string,
  productId: string,
  input: NewListing,
  newPhotos: File[],
  removedMedia: ProductMedia[],
  keptCount: number,
  status: "draft" | "pending_review",
): Promise<{ failedPhotos: number }> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("products")
    .update({
      category_slug: input.category,
      name: input.name.trim(),
      description: input.description.trim(),
      price: input.price,
      old_price: input.oldPrice ?? null,
      quantity: input.quantity,
      condition: conditionToDb(input.condition),
      negotiable: input.negotiable,
      campus: input.campus,
      city: input.city,
      specs: input.specs.filter(([k, v]) => k.trim() && v.trim()).slice(0, 12),
      duration_days: input.durationDays,
      status,
    })
    .eq("id", productId)
    .eq("seller_id", userId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Cette annonce n'est plus modifiable.");

  if (removedMedia.length > 0) {
    const del = await sb.from("product_media").delete().in("id", removedMedia.map((m) => m.id));
    if (del.error) throw del.error;
    await sb.storage.from(MEDIA_BUCKET).remove(removedMedia.map((m) => m.path));
  }

  let failed = 0;
  let position = keptCount;
  for (const file of newPhotos.slice(0, Math.max(MAX_PHOTOS - keptCount, 0))) {
    const path = `${userId}/${productId}/${position}-${crypto.randomUUID()}.${extensionOf(file)}`;
    const up = await sb.storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
    if (up.error) { failed += 1; continue; }
    const ins = await sb.from("product_media").insert({ product_id: productId, storage_path: path, position });
    if (ins.error) { failed += 1; await sb.storage.from(MEDIA_BUCKET).remove([path]); continue; }
    position += 1;
  }
  return { failedPhotos: failed };
}

/** Passe une annonce du vendeur à `archived` (retrait volontaire) ou `sold`. Les autres statuts passent par la modération. */
export async function setOwnListingStatus(productId: string, status: "archived" | "sold" | "draft" | "pending_review"): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from("products").update({ status }).eq("id", productId);
  if (error) throw error;
}

/**
 * Suppression logique (deleted_at) : l'historique des commandes reste cohérent. La policy products_update_own
 * exige que la nouvelle ligne ne soit pas `published` : on archive en même temps.
 */
export async function deleteOwnListing(productId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from("products")
    .update({ status: "archived", deleted_at: new Date().toISOString() })
    .eq("id", productId);
  if (error) throw error;
}

/* ------------------------------------------------------------------------------------------------
 * Hooks react-query
 * ------------------------------------------------------------------------------------------------ */

export const LISTINGS_PAGE_SIZE = 12;
const enabled = () => getSupabase() !== null;

export function useListings(params: Omit<ListingQuery, "limit" | "offset">) {
  return useInfiniteQuery({
    queryKey: ["listings", params.q ?? "", params.categorie ?? "", params.filters, params.tri],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchListings({ ...params, limit: LISTINGS_PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total && last.items.length > 0 ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
    enabled: enabled(),
    staleTime: 30_000,
  });
}

export function useProduct(id: string) {
  return useQuery({ queryKey: ["product", id], queryFn: () => fetchProduct(id), enabled: enabled(), staleTime: 30_000 });
}

export function useSimilarListings(product: Pick<Product, "id" | "category"> | undefined) {
  return useQuery({
    queryKey: ["similar", product?.id],
    queryFn: () => fetchSimilarListings(product!),
    enabled: enabled() && !!product,
    staleTime: 60_000,
  });
}

export function useSeller(id: string | undefined) {
  return useQuery({ queryKey: ["seller", id], queryFn: () => fetchSeller(id!), enabled: enabled() && !!id, staleTime: 60_000 });
}

export function useSellerListings(sellerId: string | undefined, publishedOnly = true) {
  return useQuery({
    queryKey: ["seller-listings", sellerId, publishedOnly],
    queryFn: () => fetchSellerListings(sellerId!, { publishedOnly }),
    enabled: enabled() && !!sellerId,
    staleTime: 30_000,
  });
}

export function useSellerReviews(sellerId: string | undefined) {
  return useQuery({ queryKey: ["seller-reviews", sellerId], queryFn: () => fetchSellerReviews(sellerId!), enabled: enabled() && !!sellerId, staleTime: 60_000 });
}

export function useCategoryCounts() {
  return useQuery({ queryKey: ["category-counts"], queryFn: fetchCategoryCounts, enabled: enabled(), staleTime: 5 * 60_000 });
}

export function useListingCampuses() {
  return useQuery({ queryKey: ["listing-campuses"], queryFn: fetchListingCampuses, enabled: enabled(), staleTime: 5 * 60_000 });
}

export function useCategoryPriceRange(slug: string | undefined) {
  return useQuery({ queryKey: ["category-price-range", slug], queryFn: () => fetchCategoryPriceRange(slug!), enabled: enabled() && !!slug, staleTime: 5 * 60_000 });
}

/** Annonces d'une liste d'identifiants, dans l'ordre demandé. Les annonces illisibles (supprimées, retirées) sont absentes. */
export function useProductsByIds(ids: string[], scope = "favorite-products") {
  return useQuery({
    queryKey: [scope, ids.join(",")],
    queryFn: async () => {
      const found = await fetchProductsByIds(ids);
      const byId = new Map(found.map((p) => [p.id, p]));
      return ids.map((id) => byId.get(id) ?? null);
    },
    enabled: enabled() && ids.length > 0,
    staleTime: 30_000,
  });
}

/** Dernières annonces publiées (accueil). */
export function useRecentListings(limit = 6) {
  return useQuery({
    queryKey: ["recent-listings", limit],
    queryFn: async () => (await fetchListings({ filters: defaultFilters, tri: "recent", limit, offset: 0 })).items,
    enabled: enabled(),
    staleTime: 30_000,
  });
}

export function useSellerRatingDistribution(sellerId: string | undefined) {
  return useQuery({ queryKey: ["seller-rating-distribution", sellerId], queryFn: () => fetchSellerRatingDistribution(sellerId!), enabled: enabled() && !!sellerId, staleTime: 60_000 });
}

export function useIsFollowing(followerId: string | undefined, sellerId: string | undefined) {
  return useQuery({ queryKey: ["following", followerId, sellerId], queryFn: () => isFollowing(followerId!, sellerId!), enabled: enabled() && !!followerId && !!sellerId && followerId !== sellerId, staleTime: 60_000 });
}

export function useMatchingListings(req: { category: string; budget: number; authorId: string } | undefined) {
  return useQuery({
    queryKey: ["matching-listings", req?.category, req?.budget, req?.authorId],
    queryFn: () => fetchMatchingListings(req!),
    enabled: enabled() && !!req,
    staleTime: 30_000,
  });
}

export function useProductMedia(productId: string | undefined) {
  return useQuery({ queryKey: ["product-media", productId], queryFn: () => fetchProductMedia(productId!), enabled: enabled() && !!productId, staleTime: 0, gcTime: 0 });
}
