import { useQuery } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";

/* Inscription payante (migration 0068). Le drapeau « paid_registration » se règle dans /admin/finances, pas dans le code :
 *  - drapeau actif : un nouveau compte est « pending_payment » (donc non actif : la base refuse tout) jusqu'au paiement ;
 *    le tarif n'est connu qu'après vérification du téléphone (le pays se déduit de l'indicatif) ;
 *  - drapeau inactif, ou pays sans tarif : le compte est « exempt » et rien ne change pour l'étudiant.
 * Cet écran ne décide jamais de l'accès : il lit my_registration et affiche ce que la base a décidé. */

export type RegistrationStatus = "pending_payment" | "paid" | "exempt";
export type MyRegistration = { status: RegistrationStatus; fee: number | null; country: string | null; paidAt: string | null };

type Raw = { success?: boolean; status?: string; fee?: number | null; country?: string | null; paid_at?: string | null };

export async function fetchMyRegistration(): Promise<MyRegistration> {
  const { data, error } = await requireSupabase().rpc("my_registration");
  if (error) throw error;
  const r = data as Raw | null;
  if (!r?.success) throw new Error("registration_unavailable");
  const status: RegistrationStatus = r.status === "pending_payment" ? "pending_payment" : r.status === "paid" ? "paid" : "exempt";
  return { status, fee: r.fee == null ? null : Number(r.fee), country: r.country ?? null, paidAt: r.paid_at ?? null };
}

export const useMyRegistration = (userId: string | undefined) =>
  useQuery({ queryKey: ["registration", userId], queryFn: fetchMyRegistration, enabled: getSupabase() !== null && !!userId, staleTime: 60_000 });
