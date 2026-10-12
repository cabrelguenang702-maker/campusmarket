import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { memberSince } from "../domain";

export type OwnProfile = {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  universityId: string | null;
  campus: string | null;
  city: string | null;
  verified: boolean;
  verifiedAt: string | null;
  bio: string | null;
  filiere: string | null;
  niveau: string | null;
  since: string;
  discoverable: boolean;
  deactivatedAt: string | null;
};

export type OwnPrivate = { email: string; phone: string | null; phoneVerified: boolean; allowStrangerMessages: boolean };

export type OwnAccount = { profile: OwnProfile; private: OwnPrivate | null; roles: string[] };

type ProfileRow = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  university_id: string | null;
  campus: string | null;
  city: string | null;
  verified: boolean;
  verified_at: string | null;
  bio: string | null;
  filiere: string | null;
  niveau: string | null;
  created_at: string;
  discoverable: boolean;
  deactivated_at: string | null;
};
type PrivateRow = { email: string; phone: string | null; phone_verified: boolean; allow_stranger_messages: boolean };

/**
 * Profil public, données privées et rôles de l'utilisateur connecté. Trois lectures en parallèle ; la RLS
 * garantit que seules ses propres lignes sont renvoyées (profile_private_select_own, user_roles : voir 0011).
 * Les rôles servent à l'AFFICHAGE (menu admin) : toute action reste vérifiée côté base.
 */
export async function fetchOwnAccount(userId: string): Promise<OwnAccount> {
  const sb = requireSupabase();
  const [profile, priv, roles] = await Promise.all([
    sb
      .from("profiles")
      .select("id, full_name, avatar_url, university_id, campus, city, verified, verified_at, bio, filiere, niveau, created_at, discoverable, deactivated_at")
      .eq("id", userId)
      .single(),
    sb
      .from("profile_private")
      .select("email, phone, phone_verified, allow_stranger_messages")
      .eq("id", userId)
      .maybeSingle(),
    sb.from("user_roles").select("role").eq("user_id", userId),
  ]);

  if (profile.error) throw profile.error;
  if (priv.error) throw priv.error;
  if (roles.error) throw roles.error;

  const p = profile.data as ProfileRow;
  const pr = priv.data as PrivateRow | null;
  return {
    profile: {
      id: p.id,
      fullName: p.full_name,
      avatarUrl: p.avatar_url,
      universityId: p.university_id,
      campus: p.campus,
      city: p.city,
      verified: p.verified,
      verifiedAt: p.verified_at,
      bio: p.bio,
      filiere: p.filiere,
      niveau: p.niveau,
      since: memberSince(p.created_at),
      discoverable: p.discoverable,
      deactivatedAt: p.deactivated_at,
    },
    private: pr ? { email: pr.email, phone: pr.phone, phoneVerified: pr.phone_verified, allowStrangerMessages: pr.allow_stranger_messages } : null,
    roles: (roles.data as { role: string }[]).map((r) => r.role),
  };
}

/** Rattache l'utilisateur à son université (campus et ville recopiés pour l'affichage et les annonces). */
export async function setOwnUniversity(
  userId: string,
  university: { id: string; short: string; city: string },
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from("profiles")
    .update({ university_id: university.id, campus: university.short, city: university.city })
    .eq("id", userId);
  if (error) throw error;
}

/* ------------------------------------------------------------------------------------------------
 * Modification du profil, photo, statistiques
 * ------------------------------------------------------------------------------------------------ */

export type ProfileEditInput = { fullName: string; bio: string; filiere: string; niveau: string; city: string };

const blank = (v: string) => (v.trim() === "" ? null : v.trim());

/** Identité publique. `verified` n'est pas modifiable par l'utilisateur : la policy profiles_update_own le refuse. */
export async function updateOwnProfile(userId: string, input: ProfileEditInput): Promise<void> {
  const { error } = await requireSupabase()
    .from("profiles")
    .update({ full_name: input.fullName.trim(), bio: blank(input.bio), filiere: blank(input.filiere), niveau: blank(input.niveau), city: blank(input.city) })
    .eq("id", userId);
  if (error) throw error;
}

export const AVATAR_BUCKET = "avatars";
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Envoie la photo dans <uid>/ puis enregistre son URL publique (le bucket est public : voir 0038). Un paramètre de version
 * évite que le navigateur serve l'ancienne image. Les anciens fichiers du dossier sont supprimés ensuite (sans bloquer).
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  if (!AVATAR_TYPES.includes(file.type)) throw new Error("Format non pris en charge : JPG, PNG ou WebP.");
  if (file.size > AVATAR_MAX_BYTES) throw new Error("Photo trop lourde : 2 Mo maximum.");
  const sb = requireSupabase();
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${userId}/${Date.now()}.${ext}`;
  const up = await sb.storage.from(AVATAR_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw up.error;
  const url = sb.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
  const { error } = await sb.from("profiles").update({ avatar_url: url }).eq("id", userId);
  if (error) {
    await sb.storage.from(AVATAR_BUCKET).remove([path]);
    throw error;
  }
  await removeOldAvatars(userId, path);
  return url;
}

export async function removeAvatar(userId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from("profiles").update({ avatar_url: null }).eq("id", userId);
  if (error) throw error;
  await removeOldAvatars(userId, null);
}

async function removeOldAvatars(userId: string, keep: string | null): Promise<void> {
  try {
    const sb = requireSupabase();
    const list = await sb.storage.from(AVATAR_BUCKET).list(userId, { limit: 100 });
    const stale = (list.data ?? []).map((f) => `${userId}/${f.name}`).filter((p) => p !== keep);
    if (stale.length) await sb.storage.from(AVATAR_BUCKET).remove(stale);
  } catch {
    /* le nettoyage est facultatif : un fichier orphelin ne gêne rien */
  }
}

export type OwnStats = { listings: number; sales: number; purchases: number; rating: number; reviews: number };

/** Chiffres de l'en-tête : annonces en ligne, ventes, achats finalisés et note moyenne. */
export async function fetchOwnStats(userId: string): Promise<OwnStats> {
  const sb = requireSupabase();
  const [stats, listings, purchases] = await Promise.all([
    sb.from("seller_stats").select("rating_avg, reviews_count, sales_count").eq("seller_id", userId).maybeSingle(),
    sb.from("products").select("id", { count: "exact", head: true }).eq("seller_id", userId).eq("status", "published").is("deleted_at", null),
    sb.from("orders").select("id", { count: "exact", head: true }).eq("buyer_id", userId).eq("status", "completed"),
  ]);
  if (stats.error) throw stats.error;
  if (listings.error) throw listings.error;
  if (purchases.error) throw purchases.error;
  const s = stats.data as { rating_avg: number; reviews_count: number; sales_count: number } | null;
  return { listings: listings.count ?? 0, sales: s?.sales_count ?? 0, purchases: purchases.count ?? 0, rating: Number(s?.rating_avg ?? 0), reviews: s?.reviews_count ?? 0 };
}

export function useOwnStats(userId: string | undefined) {
  return useQuery({ queryKey: ["own-stats", userId], queryFn: () => fetchOwnStats(userId!), enabled: !!userId && getSupabase() !== null, staleTime: 30_000 });
}

export function useProfileMutations(userId: string | undefined, refreshAccount: () => Promise<void>) {
  const qc = useQueryClient();
  const done = async () => {
    await refreshAccount();
    void qc.invalidateQueries({ queryKey: ["own-stats", userId] });
  };
  return {
    save: useMutation({ mutationFn: (input: ProfileEditInput) => updateOwnProfile(userId!, input), onSuccess: done }),
    uploadPhoto: useMutation({ mutationFn: (file: File) => uploadAvatar(userId!, file), onSuccess: done }),
    removePhoto: useMutation({ mutationFn: () => removeAvatar(userId!), onSuccess: done }),
  };
}
