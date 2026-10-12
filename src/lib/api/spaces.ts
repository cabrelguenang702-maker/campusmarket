import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { createdLabel, styleOfSpaceCategory, type MyStatus, type Privacy, type ReactionKind, type Space, type SpaceKind, type SpaceRole } from "../spaces-model";

/* Communautés et groupes (table `spaces`, kind = communaute | groupe).
 * Les droits sont tenus par la base : lecture des publications réservée aux membres, rôles hiérarchiques (owner > admin >
 * moderator > member) contrôlés par déclencheur, images dans un bucket réservé aux membres. L'interface n'affiche que ce que
 * la base accepte, mais ne s'y substitue jamais. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

const SPACE_SELECT = "id, kind, category_slug, name, description, privacy, rules, member_count, created_at, category:space_categories!category_slug(name)";
type SpaceRow = {
  id: string; kind: SpaceKind; category_slug: string; name: string; description: string; privacy: Privacy; rules: string[] | null;
  member_count: number; created_at: string; category: { name: string } | { name: string }[] | null;
};

function toSpace(r: SpaceRow): Space {
  const cat = Array.isArray(r.category) ? r.category[0] : r.category;
  const style = styleOfSpaceCategory(r.category_slug);
  return { id: r.id, kind: r.kind, name: r.name, description: r.description, categorySlug: r.category_slug, category: cat?.name ?? r.category_slug, privacy: r.privacy, rules: r.rules ?? [], memberCount: r.member_count, createdAt: createdLabel(r.created_at), icon: style.icon, tone: style.tone };
}

export async function fetchSpaces(kind: SpaceKind): Promise<Space[]> {
  const { data, error } = await requireSupabase().from("spaces").select(SPACE_SELECT).eq("kind", kind).is("deleted_at", null).is("suspended_at", null).in("privacy", ["publique", "privee"]).order("member_count", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as SpaceRow[]).map(toSpace);
}

export async function fetchSpace(id: string): Promise<Space | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await requireSupabase().from("spaces").select(SPACE_SELECT).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  return data ? toSpace(data as unknown as SpaceRow) : null;
}

export type SpaceCategory = { slug: string; name: string };
export async function fetchSpaceCategories(): Promise<SpaceCategory[]> {
  const { data, error } = await requireSupabase().from("space_categories").select("slug, name").order("sort_order");
  if (error) throw error;
  return (data ?? []) as SpaceCategory[];
}

/* ---------- Ma situation dans chaque espace ---------- */
export type MyStates = { roles: Readonly<Record<string, SpaceRole>>; pending: ReadonlySet<string> };

export async function fetchMyStates(userId: string): Promise<MyStates> {
  const sb = requireSupabase();
  const [mem, req] = await Promise.all([
    sb.from("space_members").select("space_id, role").eq("user_id", userId),
    sb.from("space_membership_requests").select("space_id").eq("user_id", userId).eq("status", "pending").is("invited_by", null),
  ]);
  if (mem.error) throw mem.error;
  if (req.error) throw req.error;
  return {
    roles: Object.fromEntries(((mem.data ?? []) as { space_id: string; role: SpaceRole }[]).map((m) => [m.space_id, m.role])),
    pending: new Set(((req.data ?? []) as { space_id: string }[]).map((r) => r.space_id)),
  };
}

export const statusIn = (states: MyStates | undefined, spaceId: string): MyStatus => states?.roles[spaceId] ?? (states?.pending.has(spaceId) ? "attente" : "aucun");

export const spacesKey = (kind: SpaceKind) => ["spaces", "list", kind] as const;
export const myStatesKey = (userId: string | undefined) => ["spaces", "mine", userId] as const;

export function useSpaces(kind: SpaceKind) {
  return useQuery({ queryKey: spacesKey(kind), queryFn: () => fetchSpaces(kind), enabled: getSupabase() !== null, staleTime: 30_000 });
}
export function useSpace(id: string) {
  return useQuery({ queryKey: ["spaces", "one", id], queryFn: () => fetchSpace(id), enabled: getSupabase() !== null, staleTime: 15_000 });
}
export function useSpaceCategories() {
  return useQuery({ queryKey: ["spaces", "categories"], queryFn: fetchSpaceCategories, enabled: getSupabase() !== null, staleTime: 10 * 60_000 });
}
export function useMyStates(userId: string | undefined) {
  return useQuery({ queryKey: myStatesKey(userId), queryFn: () => fetchMyStates(userId!), enabled: !!userId && getSupabase() !== null, staleTime: 15_000 });
}

/* ---------- Adhésion ---------- */
export type CreateSpaceInput = { kind: SpaceKind; name: string; description: string; categorySlug: string; privacy: "publique" | "privee"; rules: string[] };

export function useSpaceActions(userId: string | undefined) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["spaces"] })]);
  return {
    refresh,
    /** Espace public : on devient membre tout de suite. Espace privé : demande à valider par un administrateur. */
    join: useMutation({
      mutationFn: async (space: Pick<Space, "id" | "privacy">) => {
        const sb = requireSupabase();
        if (space.privacy === "publique") {
          const { error } = await sb.from("space_members").insert({ space_id: space.id, user_id: userId!, role: "member" });
          if (error && error.code !== "23505") throw error;
        } else {
          const { error } = await sb.from("space_membership_requests").insert({ space_id: space.id, user_id: userId! });
          if (error && error.code !== "23505") throw error;
        }
      },
      onSuccess: refresh,
    }),
    cancelRequest: useMutation({
      mutationFn: async (spaceId: string) => {
        const { error } = await requireSupabase().from("space_membership_requests").update({ status: "cancelled" }).eq("space_id", spaceId).eq("user_id", userId!).eq("status", "pending").is("invited_by", null);
        if (error) throw error;
      },
      onSuccess: refresh,
    }),
    leave: useMutation({
      mutationFn: async (spaceId: string) => {
        const { error } = await requireSupabase().from("space_members").delete().eq("space_id", spaceId).eq("user_id", userId!);
        if (error) throw error;
      },
      onSuccess: refresh,
    }),
    create: useMutation({
      mutationFn: async (input: CreateSpaceInput): Promise<string> => {
        const { data, error } = await requireSupabase().from("spaces").insert({
          kind: input.kind, category_slug: input.categorySlug, name: input.name.trim(), description: input.description.trim(),
          privacy: input.privacy, rules: input.rules.map((r) => r.trim()).filter(Boolean), created_by: userId!,
        }).select("id").single();
        if (error) throw error;
        return (data as { id: string }).id;
      },
      onSuccess: refresh,
    }),
  };
}

/* ---------- Membres ---------- */
export type SpaceMember = { userId: string; role: SpaceRole; joinedAt: string; name: string; avatarUrl: string | null; campus: string | null; verified: boolean };

const ROLE_ORDER: Record<SpaceRole, number> = { owner: 0, admin: 1, moderator: 2, member: 3 };

export async function fetchSpaceMembers(spaceId: string): Promise<SpaceMember[]> {
  const { data, error } = await requireSupabase().from("space_members_list").select("user_id, role, joined_at, full_name, avatar_url, campus, verified").eq("space_id", spaceId).limit(500);
  if (error) throw error;
  type Row = { user_id: string; role: SpaceRole; joined_at: string; full_name: string; avatar_url: string | null; campus: string | null; verified: boolean };
  return ((data ?? []) as Row[])
    .map((r) => ({ userId: r.user_id, role: r.role, joinedAt: r.joined_at, name: r.full_name, avatarUrl: r.avatar_url, campus: r.campus, verified: r.verified }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name, "fr"));
}

export type JoinRequest = { id: string; userId: string; name: string; avatarUrl: string | null; createdAt: string };

/** Demandes d'adhésion en attente (visibles par les administrateurs de l'espace). */
export async function fetchJoinRequests(spaceId: string): Promise<JoinRequest[]> {
  const { data, error } = await requireSupabase().from("space_membership_requests").select("id, user_id, created_at, user:profiles!user_id(full_name, avatar_url)").eq("space_id", spaceId).eq("status", "pending").is("invited_by", null).order("created_at");
  if (error) throw error;
  type Row = { id: string; user_id: string; created_at: string; user: { full_name: string; avatar_url: string | null } | { full_name: string; avatar_url: string | null }[] | null };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const u = Array.isArray(r.user) ? r.user[0] : r.user;
    return { id: r.id, userId: r.user_id, name: u?.full_name ?? "Étudiant", avatarUrl: u?.avatar_url ?? null, createdAt: r.created_at };
  });
}

export function useSpaceMembers(spaceId: string, enabled: boolean) {
  return useQuery({ queryKey: ["spaces", "members", spaceId], queryFn: () => fetchSpaceMembers(spaceId), enabled: enabled && getSupabase() !== null && isUuid(spaceId), staleTime: 15_000 });
}
export function useJoinRequests(spaceId: string, enabled: boolean) {
  return useQuery({ queryKey: ["spaces", "requests", spaceId], queryFn: () => fetchJoinRequests(spaceId), enabled: enabled && getSupabase() !== null && isUuid(spaceId), staleTime: 10_000 });
}

export function useMemberActions(spaceId: string) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["spaces", "members", spaceId] }), qc.invalidateQueries({ queryKey: ["spaces", "requests", spaceId] }), qc.invalidateQueries({ queryKey: ["spaces", "one", spaceId] }), qc.invalidateQueries({ queryKey: ["spaces", "list"] })]);
  return {
    setRole: useMutation({
      mutationFn: async ({ userId, role }: { userId: string; role: Exclude<SpaceRole, "owner"> }) => {
        const { data, error } = await requireSupabase().from("space_members").update({ role }).eq("space_id", spaceId).eq("user_id", userId).select("user_id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Ce changement de rôle n'est pas autorisé.");
      },
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (userId: string) => {
        const { data, error } = await requireSupabase().from("space_members").delete().eq("space_id", spaceId).eq("user_id", userId).select("user_id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Vous ne pouvez pas exclure ce membre.");
      },
      onSuccess: refresh,
    }),
    decide: useMutation({
      mutationFn: async ({ requestId, approve }: { requestId: string; approve: boolean }) => {
        const { data, error } = await requireSupabase().from("space_membership_requests").update({ status: approve ? "approved" : "rejected" }).eq("id", requestId).eq("status", "pending").select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Cette demande a déjà été traitée.");
      },
      onSuccess: refresh,
    }),
  };
}

/* ---------- Publications ---------- */
export type FeedPost = {
  id: string; spaceId: string; authorId: string; authorName: string; authorAvatar: string | null; text: string;
  imagePath: string | null; imageUrl: string | null; pinned: boolean; createdAt: string;
  reactions: Partial<Record<ReactionKind, number>>; commentCount: number; myReaction: ReactionKind | null;
};

const PAGE = 20;
type FeedRow = {
  id: string; space_id: string; author_id: string; author_name: string; author_avatar: string | null; body: string; image_path: string | null;
  pinned: boolean; created_at: string; reactions: Partial<Record<ReactionKind, number>> | null; comment_count: number; my_reaction: ReactionKind | null;
};

/** Page de publications (épinglées d'abord à la première page, puis du plus récent au plus ancien). */
export async function fetchFeedPage(spaceId: string, before: string | null): Promise<{ posts: FeedPost[]; next: string | null }> {
  const sb = requireSupabase();
  let q = sb.from("space_posts_feed").select("id, space_id, author_id, author_name, author_avatar, body, image_path, pinned, created_at, reactions, comment_count, my_reaction").eq("space_id", spaceId).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(PAGE + 1);
  if (before) q = q.lt("created_at", before).eq("pinned", false);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as FeedRow[];
  const page = rows.slice(0, PAGE);
  const paths = page.map((r) => r.image_path).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length) {
    const signed = await sb.storage.from("space-media").createSignedUrls(paths, 3600);
    for (const s of signed.data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  const posts = page.map((r): FeedPost => ({
    id: r.id, spaceId: r.space_id, authorId: r.author_id, authorName: r.author_name, authorAvatar: r.author_avatar, text: r.body,
    imagePath: r.image_path, imageUrl: r.image_path ? (urls.get(r.image_path) ?? null) : null, pinned: r.pinned, createdAt: r.created_at,
    reactions: r.reactions ?? {}, commentCount: r.comment_count, myReaction: r.my_reaction,
  }));
  const last = page[page.length - 1];
  return { posts, next: rows.length > PAGE && last ? last.created_at : null };
}

export function useFeed(spaceId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["spaces", "feed", spaceId],
    queryFn: ({ pageParam }) => fetchFeedPage(spaceId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    enabled: enabled && getSupabase() !== null && isUuid(spaceId),
    staleTime: 15_000,
  });
}

export const POST_IMAGE_MAX = 5 * 1024 * 1024;
export const POST_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function checkPostImage(file: File): string | null {
  if (!POST_IMAGE_TYPES.includes(file.type)) return "Format non pris en charge : JPG, PNG ou WebP.";
  if (file.size > POST_IMAGE_MAX) return "Image trop lourde : 5 Mo maximum.";
  return null;
}

export function usePostActions(spaceId: string, userId: string | undefined) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["spaces", "feed", spaceId] });
  return {
    create: useMutation({
      mutationFn: async ({ text, image }: { text: string; image: File | null }) => {
        const sb = requireSupabase();
        let path: string | null = null;
        if (image) {
          const problem = checkPostImage(image);
          if (problem) throw new Error(problem);
          const ext = image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
          path = `${spaceId}/${userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
          const up = await sb.storage.from("space-media").upload(path, image, { contentType: image.type, upsert: false });
          if (up.error) throw up.error;
        }
        const { error } = await sb.from("space_posts").insert({ space_id: spaceId, author_id: userId!, body: text.trim(), image_path: path });
        if (error) {
          if (path) await sb.storage.from("space-media").remove([path]);
          throw error;
        }
      },
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (post: Pick<FeedPost, "id" | "imagePath">) => {
        const sb = requireSupabase();
        const { error } = await sb.from("space_posts").delete().eq("id", post.id);
        if (error) throw error;
        if (post.imagePath) await sb.storage.from("space-media").remove([post.imagePath]); // peut échouer pour une image d'autrui : sans gravité
      },
      onSuccess: refresh,
    }),
    pin: useMutation({
      mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
        const { data, error } = await requireSupabase().from("space_posts").update({ pinned }).eq("id", id).select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Action non autorisée.");
      },
      onSuccess: refresh,
    }),
    /** Une seule réaction par personne et par publication : la même réaction une 2e fois la retire. */
    react: useMutation({
      mutationFn: async ({ postId, kind, current }: { postId: string; kind: ReactionKind; current: ReactionKind | null }) => {
        const sb = requireSupabase();
        if (current === kind) {
          const { error } = await sb.from("space_post_reactions").delete().eq("post_id", postId).eq("user_id", userId!);
          if (error) throw error;
        } else {
          const { error } = await sb.from("space_post_reactions").upsert({ post_id: postId, user_id: userId!, kind }, { onConflict: "post_id,user_id" });
          if (error) throw error;
        }
      },
      onSuccess: refresh,
    }),
  };
}

/* ---------- Commentaires ---------- */
export type PostComment = { id: string; authorId: string; authorName: string; text: string; createdAt: string };

export async function fetchComments(postId: string): Promise<PostComment[]> {
  const { data, error } = await requireSupabase().from("space_post_comments").select("id, author_id, body, created_at, author:profiles!author_id(full_name)").eq("post_id", postId).order("created_at").limit(200);
  if (error) throw error;
  type Row = { id: string; author_id: string; body: string; created_at: string; author: { full_name: string } | { full_name: string }[] | null };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const a = Array.isArray(r.author) ? r.author[0] : r.author;
    return { id: r.id, authorId: r.author_id, authorName: a?.full_name ?? "Étudiant", text: r.body, createdAt: r.created_at };
  });
}

export function useComments(postId: string, enabled: boolean) {
  return useQuery({ queryKey: ["spaces", "comments", postId], queryFn: () => fetchComments(postId), enabled: enabled && getSupabase() !== null, staleTime: 10_000 });
}

export function useCommentActions(postId: string, spaceId: string, userId: string | undefined) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["spaces", "comments", postId] }), qc.invalidateQueries({ queryKey: ["spaces", "feed", spaceId] })]);
  return {
    add: useMutation({
      mutationFn: async (text: string) => {
        const { error } = await requireSupabase().from("space_post_comments").insert({ post_id: postId, author_id: userId!, body: text.trim() });
        if (error) throw error;
      },
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (commentId: string) => {
        const { error } = await requireSupabase().from("space_post_comments").delete().eq("id", commentId);
        if (error) throw error;
      },
      onSuccess: refresh,
    }),
  };
}

/* ---------- Mes communautés / mes groupes (onglets du profil) ---------- */
export type MySpace = { id: string; name: string; memberCount: number; role: SpaceRole };

export async function fetchMySpaces(userId: string, kind: SpaceKind): Promise<MySpace[]> {
  const { data, error } = await requireSupabase().from("space_members").select("role, spaces!space_id!inner(id, kind, name, member_count, deleted_at)").eq("user_id", userId).eq("spaces.kind", kind).is("spaces.deleted_at", null);
  if (error) throw error;
  type Row = { role: SpaceRole; spaces: { id: string; name: string; member_count: number } | { id: string; name: string; member_count: number }[] };
  return ((data ?? []) as unknown as Row[]).flatMap((r) => {
    const s = Array.isArray(r.spaces) ? r.spaces[0] : r.spaces;
    return s ? [{ id: s.id, name: s.name, memberCount: s.member_count, role: r.role }] : [];
  });
}

export function useMySpaces(userId: string | undefined, kind: SpaceKind) {
  return useQuery({ queryKey: ["spaces", "mine-list", userId, kind], queryFn: () => fetchMySpaces(userId!, kind), enabled: !!userId && getSupabase() !== null, staleTime: 15_000 });
}
