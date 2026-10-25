import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { friendlyError } from "./errors";

/* Groupes de révision (migration 0062) : groupes, membres, séances, présences.
 * Les droits sont tenus par la base : tout le monde voit les groupes actifs, seuls les membres voient les membres et les séances,
 * seul le propriétaire programme ou annule une séance, la capacité et le départ du propriétaire sont gérés par déclencheur. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isStudyId = (s: string) => UUID.test(s);

export type StudyGroup = {
  id: string; title: string; subject: string; description: string; courseId: string | null; courseTitle: string | null;
  universityName: string | null; maxMembers: number; memberCount: number; archived: boolean; createdAt: string; ownerName: string | null;
  isMember: boolean; isOwner: boolean;
};
export type GroupMember = { userId: string; role: "owner" | "member"; name: string; avatarUrl: string | null; campus: string | null; verified: boolean };
export type RsvpStatus = "going" | "maybe";
export type GroupSession = {
  id: string; title: string; startsAt: string; durationMinutes: number; location: string | null; notes: string | null; cancelled: boolean;
  going: string[]; maybe: string[]; myStatus: RsvpStatus | null;
};
export type EnrolledCourse = { id: string; title: string };

type GroupRow = {
  id: string; title: string; subject: string; description: string | null; course_id: string | null; course_title: string | null;
  university_name: string | null; max_members: number; member_count: number; archived_at: string | null; created_at: string;
  owner_name: string | null; is_member: boolean | null; is_owner: boolean | null;
};
const GROUP_SELECT = "id, title, subject, description, course_id, course_title, university_name, max_members, member_count, archived_at, created_at, owner_name, is_member, is_owner";

const toGroup = (r: GroupRow): StudyGroup => ({
  id: r.id, title: r.title, subject: r.subject, description: r.description ?? "", courseId: r.course_id, courseTitle: r.course_title,
  universityName: r.university_name, maxMembers: r.max_members, memberCount: r.member_count, archived: r.archived_at !== null,
  createdAt: r.created_at, ownerName: r.owner_name?.trim() || null, isMember: r.is_member === true, isOwner: r.is_owner === true,
});

export async function fetchStudyGroups(): Promise<StudyGroup[]> {
  const { data, error } = await requireSupabase().from("study_groups_overview").select(GROUP_SELECT).is("archived_at", null).order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return ((data ?? []) as unknown as GroupRow[]).map(toGroup);
}

export async function fetchStudyGroup(id: string): Promise<StudyGroup | null> {
  if (!isStudyId(id)) return null;
  const { data, error } = await requireSupabase().from("study_groups_overview").select(GROUP_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toGroup(data as unknown as GroupRow) : null;
}

export async function fetchGroupMembers(groupId: string): Promise<GroupMember[]> {
  const { data, error } = await requireSupabase().from("study_group_members_list").select("user_id, role, joined_at, full_name, avatar_url, campus, verified").eq("group_id", groupId).order("joined_at", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as { user_id: string; role: "owner" | "member"; full_name: string | null; avatar_url: string | null; campus: string | null; verified: boolean | null }[];
  return rows
    .map((m) => ({ userId: m.user_id, role: m.role, name: m.full_name?.trim() || "Étudiant", avatarUrl: m.avatar_url, campus: m.campus, verified: m.verified === true }))
    .sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
}

export async function fetchGroupSessions(groupId: string, userId: string): Promise<GroupSession[]> {
  const sb = requireSupabase();
  const { data, error } = await sb.from("study_sessions").select("id, title, starts_at, duration_minutes, location, notes, cancelled_at").eq("group_id", groupId).order("starts_at", { ascending: true });
  if (error) throw error;
  const sessions = (data ?? []) as { id: string; title: string; starts_at: string; duration_minutes: number; location: string | null; notes: string | null; cancelled_at: string | null }[];
  const ids = sessions.map((s) => s.id);
  let rsvps: { session_id: string; user_id: string; status: RsvpStatus }[] = [];
  if (ids.length > 0) {
    const r = await sb.from("study_session_rsvps_list").select("session_id, user_id, status").in("session_id", ids);
    if (r.error) throw r.error;
    rsvps = (r.data ?? []) as typeof rsvps;
  }
  return sessions.map((s) => {
    const mine = rsvps.filter((x) => x.session_id === s.id);
    return {
      id: s.id, title: s.title, startsAt: s.starts_at, durationMinutes: s.duration_minutes, location: s.location, notes: s.notes, cancelled: s.cancelled_at !== null,
      going: mine.filter((x) => x.status === "going").map((x) => x.user_id), maybe: mine.filter((x) => x.status === "maybe").map((x) => x.user_id),
      myStatus: mine.find((x) => x.user_id === userId)?.status ?? null,
    };
  });
}

/** Formations suivies activement : seules celles-ci peuvent être liées à un groupe (règle de la base). */
export async function fetchEnrolledCourses(userId: string): Promise<EnrolledCourse[]> {
  const sb = requireSupabase();
  const enr = await sb.from("course_enrollments").select("course_id").eq("user_id", userId).eq("status", "active");
  if (enr.error) throw enr.error;
  const ids = ((enr.data ?? []) as { course_id: string }[]).map((e) => e.course_id);
  if (ids.length === 0) return [];
  const c = await sb.from("courses").select("id, title").in("id", ids).order("title");
  if (c.error) throw c.error;
  return (c.data ?? []) as EnrolledCourse[];
}

const enabled = () => getSupabase() !== null;
export const useStudyGroups = () => useQuery({ queryKey: ["study", "groups"], queryFn: fetchStudyGroups, enabled: enabled(), staleTime: 20_000 });
export const useStudyGroup = (id: string) => useQuery({ queryKey: ["study", "group", id], queryFn: () => fetchStudyGroup(id), enabled: enabled() && isStudyId(id), staleTime: 15_000 });
export const useGroupMembers = (id: string, isMember: boolean) => useQuery({ queryKey: ["study", "members", id], queryFn: () => fetchGroupMembers(id), enabled: enabled() && isMember, staleTime: 15_000 });
export const useGroupSessions = (id: string, userId: string | undefined, isMember: boolean) =>
  useQuery({ queryKey: ["study", "sessions", id, userId], queryFn: () => fetchGroupSessions(id, userId!), enabled: enabled() && isMember && !!userId, staleTime: 15_000 });
export const useEnrolledCourses = (userId: string | undefined) =>
  useQuery({ queryKey: ["study", "enrolled", userId], queryFn: () => fetchEnrolledCourses(userId!), enabled: enabled() && !!userId, staleTime: 5 * 60_000 });

/** Messages des règles de la base (déclencheurs) ; sinon le texte générique. */
const DB_MESSAGES: [string, string][] = [
  ["group_full", "Ce groupe est complet."],
  ["group_archived", "Ce groupe est archivé."],
  ["group_not_available", "Ce groupe n'est pas disponible pour vous."],
  ["session_in_past", "La séance doit être programmée dans le futur."],
  ["max_members_below_count", "Le maximum ne peut pas être inférieur au nombre actuel de membres."],
  ["protected_column", "Cette modification n'est pas autorisée."],
  ["row-level security", "Action non autorisée : vérifiez que votre compte est actif et que vous suivez bien la formation choisie."],
  ["duplicate key", "C'est déjà fait."],
];
export function studyError(e: unknown, fallback = "Action impossible. Réessayez dans un instant."): string {
  const msg = typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : "";
  const hit = DB_MESSAGES.find(([k]) => msg.includes(k));
  if (hit) return hit[1];
  if (/rate.?limit|too many/i.test(msg)) return "Vous avez atteint la limite quotidienne pour cette action. Réessayez demain.";
  return friendlyError(e, fallback);
}

export type NewGroup = { title: string; subject: string; description: string; maxMembers: number; courseId: string | null };
export type NewSession = { groupId: string; title: string; startsAt: string; durationMinutes: number; location: string; notes: string };
const nullIfEmpty = (s: string) => (s.trim() === "" ? null : s.trim());

export function useStudyGroupActions(userId: string | undefined) {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["study"] }); };
  const uid = () => { if (!userId) throw new Error("Connexion requise."); return userId; };
  const sb = () => requireSupabase();
  return {
    create: useMutation({
      mutationFn: async (v: NewGroup): Promise<string> => {
        const { data, error } = await sb().from("study_groups").insert({ created_by: uid(), title: v.title.trim(), subject: v.subject.trim(), description: nullIfEmpty(v.description), max_members: v.maxMembers, course_id: v.courseId }).select("id").single();
        if (error) throw error;
        return (data as { id: string }).id;
      }, onSettled: refresh,
    }),
    join: useMutation({ mutationFn: async (groupId: string) => { const { error } = await sb().from("study_group_members").insert({ group_id: groupId, user_id: uid() }); if (error) throw error; }, onSettled: refresh }),
    leave: useMutation({ mutationFn: async (groupId: string) => { const { error } = await sb().from("study_group_members").delete().eq("group_id", groupId).eq("user_id", uid()); if (error) throw error; }, onSettled: refresh }),
    kick: useMutation({ mutationFn: async (v: { groupId: string; userId: string }) => { const { error } = await sb().from("study_group_members").delete().eq("group_id", v.groupId).eq("user_id", v.userId); if (error) throw error; }, onSettled: refresh }),
    update: useMutation({
      mutationFn: async (v: { id: string; title: string; subject: string; description: string; maxMembers: number }) => {
        const { error } = await sb().from("study_groups").update({ title: v.title.trim(), subject: v.subject.trim(), description: nullIfEmpty(v.description), max_members: v.maxMembers }).eq("id", v.id);
        if (error) throw error;
      }, onSettled: refresh,
    }),
    archive: useMutation({ mutationFn: async (id: string) => { const { error } = await sb().from("study_groups").update({ archived_at: new Date().toISOString() }).eq("id", id); if (error) throw error; }, onSettled: refresh }),
    createSession: useMutation({
      mutationFn: async (v: NewSession) => {
        const { error } = await sb().from("study_sessions").insert({ group_id: v.groupId, created_by: uid(), title: v.title.trim(), starts_at: v.startsAt, duration_minutes: v.durationMinutes, location: nullIfEmpty(v.location), notes: nullIfEmpty(v.notes) });
        if (error) throw error;
      }, onSettled: refresh,
    }),
    cancelSession: useMutation({ mutationFn: async (id: string) => { const { error } = await sb().from("study_sessions").update({ cancelled_at: new Date().toISOString() }).eq("id", id); if (error) throw error; }, onSettled: refresh }),
    rsvp: useMutation({
      mutationFn: async (v: { sessionId: string; status: RsvpStatus | null }) => {
        if (v.status === null) {
          const { error } = await sb().from("study_session_rsvps").delete().eq("session_id", v.sessionId).eq("user_id", uid());
          if (error) throw error;
        } else {
          const { error } = await sb().from("study_session_rsvps").upsert({ session_id: v.sessionId, user_id: uid(), status: v.status }, { onConflict: "session_id,user_id" });
          if (error) throw error;
        }
      }, onSettled: refresh,
    }),
  };
}
