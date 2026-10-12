import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";

/* Double authentification (TOTP) du personnel. Côté base, les fonctions admin_* exigent une session aal2
 * (public.has_mfa_session) : sans facteur vérifié ET code saisi dans cette session, les actions sensibles sont refusées. */

export type MfaFactor = { id: string; friendlyName: string | null; createdAt: string };
export type MfaState = { factors: MfaFactor[]; currentLevel: "aal1" | "aal2" | null; nextLevel: "aal1" | "aal2" | null };

export async function fetchMfaState(): Promise<MfaState> {
  const auth = requireSupabase().auth;
  const [factors, aal] = await Promise.all([auth.mfa.listFactors(), auth.mfa.getAuthenticatorAssuranceLevel()]);
  if (factors.error) throw factors.error;
  if (aal.error) throw aal.error;
  return {
    factors: factors.data.totp.map((f) => ({ id: f.id, friendlyName: f.friendly_name ?? null, createdAt: f.created_at })),
    currentLevel: aal.data.currentLevel,
    nextLevel: aal.data.nextLevel,
  };
}

export type MfaEnrollment = { factorId: string; qrCode: string; secret: string };

/** Démarre l'activation : le facteur reste « non vérifié » tant qu'un premier code n'a pas été confirmé. */
export async function startMfaEnrollment(): Promise<MfaEnrollment> {
  const auth = requireSupabase().auth;
  // Un enrôlement abandonné laisse un facteur non vérifié qui bloque le suivant : on le retire d'abord.
  const existing = await auth.mfa.listFactors();
  if (existing.error) throw existing.error;
  for (const f of existing.data.all) {
    if (f.factor_type === "totp" && f.status === "unverified") await auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await auth.mfa.enroll({ factorType: "totp", friendlyName: `CampusMarket ${new Date().toISOString().slice(0, 10)}` });
  if (error) throw error;
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Vérifie un code à 6 chiffres : active le facteur (premier code) ou élève la session à aal2 (connexions suivantes). */
export async function verifyMfaCode(factorId: string, code: string): Promise<void> {
  const { error } = await requireSupabase().auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw error;
  // Le jeton doit être renouvelé pour porter le niveau aal2 que la base contrôle.
  const refreshed = await requireSupabase().auth.refreshSession();
  if (refreshed.error) throw refreshed.error;
}

export async function removeMfaFactor(factorId: string): Promise<void> {
  const { error } = await requireSupabase().auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

export const MFA_KEY = ["mfa-state"] as const;

export function useMfaState() {
  return useQuery({ queryKey: MFA_KEY, queryFn: fetchMfaState, enabled: getSupabase() !== null, staleTime: 15_000 });
}

export function useMfaActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: MFA_KEY });
  return {
    enroll: useMutation({ mutationFn: startMfaEnrollment }),
    verify: useMutation({ mutationFn: ({ factorId, code }: { factorId: string; code: string }) => verifyMfaCode(factorId, code), onSuccess: refresh }),
    remove: useMutation({ mutationFn: removeMfaFactor, onSuccess: refresh }),
  };
}
