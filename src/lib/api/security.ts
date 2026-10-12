import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";
import { getSupabase, requireSupabase } from "../supabase";

/* Sécurité du compte : mot de passe, appareils, historique de connexion. Supabase ne donne pas au navigateur la liste
 * des sessions actives : « appareils » = appareils déjà vus à la connexion (known_devices, rempli par record_login),
 * et la seule action sur les sessions est « déconnecter tous les autres appareils » (signOut scope: others). */

const FINGERPRINT_KEY = "cm-device-id";

/** Identifiant stable de CE navigateur (aléatoire, local). Ce n'est pas une empreinte matérielle. */
export function deviceFingerprint(): string {
  try {
    let id = window.localStorage.getItem(FINGERPRINT_KEY);
    if (!id || id.length < 8) {
      id = crypto.randomUUID();
      window.localStorage.setItem(FINGERPRINT_KEY, id);
    }
    return id;
  } catch {
    return `session-${crypto.randomUUID()}`;
  }
}

/** « Chrome · Windows » à partir du user-agent (approximatif, suffisant pour reconnaître un appareil). */
export function deviceLabel(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navigateur";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Appareil";
  return `${browser} · ${os}`;
}

/** À appeler après une connexion réussie. Un échec ne doit jamais empêcher de se connecter. */
export async function recordLogin(): Promise<{ newDevice: boolean } | null> {
  try {
    const { data, error } = await requireSupabase().rpc("record_login", { p_device_fingerprint: deviceFingerprint(), p_user_agent: navigator.userAgent.slice(0, 300), p_label: deviceLabel() });
    if (error) return null;
    return { newDevice: Boolean((data as { new_device?: boolean } | null)?.new_device) };
  } catch {
    return null;
  }
}

export type KnownDevice = { id: string; label: string; lastSeenAt: string; firstSeenAt: string; current: boolean };

export async function fetchKnownDevices(userId: string): Promise<KnownDevice[]> {
  const here = deviceFingerprint();
  const { data, error } = await requireSupabase().from("known_devices").select("id, device_fingerprint, label, first_seen_at, last_seen_at").eq("user_id", userId).order("last_seen_at", { ascending: false }).limit(20);
  if (error) throw error;
  type Row = { id: string; device_fingerprint: string; label: string | null; first_seen_at: string; last_seen_at: string };
  return ((data ?? []) as Row[]).map((r) => ({ id: r.id, label: r.label ?? "Appareil", lastSeenAt: r.last_seen_at, firstSeenAt: r.first_seen_at, current: r.device_fingerprint === here }));
}

export type LoginEvent = { id: string; type: "login_success" | "new_device_detected" | "password_changed" | "mfa_enabled" | "mfa_disabled"; device: string | null; at: string };

export async function fetchLoginHistory(): Promise<LoginEvent[]> {
  const { data, error } = await requireSupabase().rpc("my_login_history", { p_limit: 30 });
  if (error) throw error;
  return ((data ?? []) as { id: string; event_type: LoginEvent["type"]; device: string | null; created_at: string }[]).map((r) => ({ id: r.id, type: r.event_type, device: r.device, at: r.created_at }));
}

/**
 * Vérifie un mot de passe SANS toucher à la session en cours : on utilise un client jetable (rien n'est stocké).
 * Un signInWithPassword sur le client principal remplacerait la session, et pour un compte avec double authentification
 * il la ferait retomber au niveau aal1 (code redemandé).
 */
export async function verifyPasswordIsolated(email: string, password: string): Promise<"ok" | "wrong"> {
  const probe = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await probe.auth.signInWithPassword({ email, password });
  if (!error) return "ok";
  if (error.status === 400 || /invalid login/i.test(error.message)) return "wrong";
  throw error;
}

/** Changement de mot de passe : on revérifie l'ancien avant d'accepter le nouveau. */
export async function changePassword(email: string, current: string, next: string): Promise<"wrong_current" | "ok"> {
  if ((await verifyPasswordIsolated(email, current)) === "wrong") return "wrong_current";
  const sb = requireSupabase();
  const { error } = await sb.auth.updateUser({ password: next });
  if (error) throw error;
  await sb.rpc("log_my_security_event", { p_event: "password_changed" });
  return "ok";
}

export async function signOutOtherDevices(): Promise<void> {
  const { error } = await requireSupabase().auth.signOut({ scope: "others" });
  if (error) throw error;
}

/** Demande de changement d'adresse : Supabase envoie un lien de confirmation à la NOUVELLE adresse. */
export async function requestEmailChange(newEmail: string): Promise<void> {
  const { error } = await requireSupabase().auth.updateUser({ email: newEmail.trim() });
  if (error) throw error;
}

export async function logSecurityEvent(event: "mfa_enabled" | "mfa_disabled"): Promise<void> {
  try {
    await requireSupabase().rpc("log_my_security_event", { p_event: event });
  } catch {
    /* journal facultatif côté interface */
  }
}

export function useKnownDevices(userId: string | undefined) {
  return useQuery({ queryKey: ["known-devices", userId], queryFn: () => fetchKnownDevices(userId!), enabled: !!userId && getSupabase() !== null, staleTime: 15_000 });
}

export function useLoginHistory(userId: string | undefined) {
  return useQuery({ queryKey: ["login-history", userId], queryFn: fetchLoginHistory, enabled: !!userId && getSupabase() !== null, staleTime: 15_000 });
}

export function useSignOutOthers() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: signOutOtherDevices, onSuccess: () => qc.invalidateQueries({ queryKey: ["known-devices"] }) });
}

/* ---------- Utilisateurs bloqués ---------- */
export type BlockedUser = { id: string; name: string; since: string };

export async function fetchBlockedUsers(userId: string): Promise<BlockedUser[]> {
  const { data, error } = await requireSupabase().from("blocked_users").select("blocked_id, created_at, blocked:profiles!blocked_id(full_name)").eq("blocker_id", userId).order("created_at", { ascending: false });
  if (error) throw error;
  type Row = { blocked_id: string; created_at: string; blocked: { full_name: string } | { full_name: string }[] | null };
  return ((data ?? []) as Row[]).map((r) => {
    const b = Array.isArray(r.blocked) ? r.blocked[0] : r.blocked;
    return { id: r.blocked_id, name: b?.full_name ?? "Membre", since: r.created_at };
  });
}

export function useBlockedUsers(userId: string | undefined) {
  return useQuery({ queryKey: ["blocked-users", userId], queryFn: () => fetchBlockedUsers(userId!), enabled: !!userId && getSupabase() !== null, staleTime: 15_000 });
}

/* ---------- Réglages de visibilité ---------- */
export type VisibilitySettings = { discoverable: boolean; allowStrangerMessages: boolean };

export async function saveVisibility(userId: string, v: Partial<VisibilitySettings>): Promise<void> {
  const sb = requireSupabase();
  if (v.discoverable !== undefined) {
    const { error } = await sb.from("profiles").update({ discoverable: v.discoverable }).eq("id", userId);
    if (error) throw error;
  }
  if (v.allowStrangerMessages !== undefined) {
    const { error } = await sb.from("profile_private").update({ allow_stranger_messages: v.allowStrangerMessages }).eq("id", userId);
    if (error) throw error;
  }
}

/* ---------- Désactivation, réactivation, export ---------- */
export async function deactivateAccount(reason: string): Promise<void> {
  const { error } = await requireSupabase().rpc("deactivate_my_account", { p_reason: reason.trim() || null });
  if (error) throw error;
}

export async function reactivateAccount(): Promise<void> {
  const { error } = await requireSupabase().rpc("reactivate_my_account");
  if (error) throw error;
}

/** Récupère toutes les données personnelles (JSON) et déclenche le téléchargement dans le navigateur. */
export async function downloadMyData(): Promise<void> {
  const { data, error } = await requireSupabase().rpc("export_my_data");
  if (error) throw error;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `campusmarket-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Back-office : retire les facteurs TOTP d'un utilisateur qui a perdu son téléphone (admin, session aal2, motif obligatoire). */
export async function adminResetUserMfa(userId: string, reason: string): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await requireSupabase().rpc("admin_reset_user_mfa", { p_user_id: userId, p_reason: reason });
  if (error) throw error;
  const r = data as { success?: boolean; error?: string } | null;
  return r?.success ? { ok: true } : { ok: false, reason: r?.error ?? "refused" };
}
