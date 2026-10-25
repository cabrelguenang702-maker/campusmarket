import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { UserFacingError } from "./errors";
import type { SpaceKind } from "../spaces-model";

/* Gestion d'un espace : modifier une publication, régler l'espace, inviter des personnes, répondre à une invitation.
 * Les droits restent ceux de la base : l'auteur seul modifie sa publication (non épinglée), les propriétaires et administrateurs
 * règlent l'espace (le type, le créateur et le nombre de membres sont verrouillés, migration 0056), et seul un administrateur invite. */

export function useEditPost(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const body = text.trim();
      if (body.length < 1 || body.length > 3000) throw new UserFacingError("Le texte doit faire entre 1 et 3 000 caractères.");
      const { data, error } = await requireSupabase().from("space_posts").update({ body }).eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new UserFacingError("Cette publication ne peut plus être modifiée (elle est épinglée, masquée ou supprimée).");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["spaces", "feed", spaceId] }),
  });
}

export type SpaceSettings = { name: string; description: string; categorySlug: string; privacy: "publique" | "privee"; rules: string[] };

export function useUpdateSpace(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: SpaceSettings) => {
      const rules = s.rules.map((r) => r.trim()).filter(Boolean).slice(0, 8);
      const { data, error } = await requireSupabase().from("spaces")
        .update({ name: s.name.trim(), description: s.description.trim(), category_slug: s.categorySlug, privacy: s.privacy, rules })
        .eq("id", spaceId).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new UserFacingError("Seuls le propriétaire et les administrateurs peuvent régler cet espace.");
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["spaces", "one", spaceId] }), qc.invalidateQueries({ queryKey: ["spaces", "list"] })]),
  });
}

/* ---------- Invitations ---------- */
export type Person = { id: string; name: string; campus: string | null; avatarUrl: string | null };

/** Recherche de personnes qui acceptent d'être trouvées (réglage de visibilité du profil). */
export async function searchPeople(query: string, selfId: string): Promise<Person[]> {
  const q = query.trim().replace(/[%_,()]/g, " ").trim();
  if (q.length < 2) return [];
  const { data, error } = await requireSupabase().from("profiles").select("id, full_name, campus, avatar_url").eq("discoverable", true).neq("id", selfId).ilike("full_name", `%${q}%`).limit(8);
  if (error) throw error;
  return ((data ?? []) as { id: string; full_name: string; campus: string | null; avatar_url: string | null }[]).map((r) => ({ id: r.id, name: r.full_name, campus: r.campus, avatarUrl: r.avatar_url }));
}
export const usePeopleSearch = (query: string, selfId: string | undefined) =>
  useQuery({ queryKey: ["people-search", query.trim()], queryFn: () => searchPeople(query, selfId!), enabled: getSupabase() !== null && !!selfId && query.trim().length >= 2, staleTime: 30_000 });

export function useInvitePerson(spaceId: string, inviterId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await requireSupabase().from("space_membership_requests").insert({ space_id: spaceId, user_id: userId, invited_by: inviterId! });
      if (error) {
        if (error.code === "23505") throw new UserFacingError("Cette personne a déjà une invitation ou une demande en attente.");
        throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["spaces", "requests", spaceId] }),
  });
}

export type MyInvitation = { id: string; spaceId: string; spaceName: string; kind: SpaceKind; inviterName: string };

export async function fetchMyInvitations(userId: string): Promise<MyInvitation[]> {
  const { data, error } = await requireSupabase().from("space_membership_requests")
    .select("id, space_id, space:spaces!space_id(name, kind, deleted_at, suspended_at), inviter:profiles!invited_by(full_name)")
    .eq("user_id", userId).eq("status", "pending").not("invited_by", "is", null).order("created_at", { ascending: false });
  if (error) throw error;
  type One<T> = T | T[] | null;
  type Row = { id: string; space_id: string; space: One<{ name: string; kind: SpaceKind; deleted_at: string | null; suspended_at: string | null }>; inviter: One<{ full_name: string }> };
  const first = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  return ((data ?? []) as unknown as Row[]).flatMap((r) => {
    const s = first(r.space);
    if (!s || s.deleted_at || s.suspended_at) return [];
    return [{ id: r.id, spaceId: r.space_id, spaceName: s.name, kind: s.kind, inviterName: first(r.inviter)?.full_name ?? "Un administrateur" }];
  });
}
export const useMyInvitations = (userId: string | undefined) =>
  useQuery({ queryKey: ["spaces", "invitations", userId], queryFn: () => fetchMyInvitations(userId!), enabled: !!userId && getSupabase() !== null, staleTime: 15_000 });

export function useRespondInvitation(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => {
      const { data, error } = await requireSupabase().from("space_membership_requests").update({ status: accept ? "approved" : "rejected" }).eq("id", id).eq("status", "pending").select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new UserFacingError("Cette invitation n'est plus valable.");
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["spaces"] }), qc.invalidateQueries({ queryKey: ["spaces", "invitations", userId] })]),
  });
}
