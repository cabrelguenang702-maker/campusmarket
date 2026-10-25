import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { UserFacingError, friendlyError } from "./errors";

/* Universités, pays et suggestions côté back-office. Écriture réservée aux administrateurs (politiques de 0018, verrou de double
 * authentification de 0054) ; le personnel lit tout, y compris les universités désactivées. Une université qui a des étudiants
 * ne se supprime pas (déclencheur de 0018) : on la désactive. Les suggestions se traitent par admin_review_university_suggestion. */

export const REGIONS = ["Afrique centrale", "Afrique de l'Ouest", "Afrique du Nord", "Afrique de l'Est", "Afrique australe"] as const;
export const PROVIDERS = ["MTN MoMo", "Orange Money", "Moov Money", "Airtel Money", "Wave", "Carte bancaire"] as const;

/** Drapeau d'après le code pays à 2 lettres (indicateurs régionaux Unicode). */
export const flagFromCode = (code: string): string =>
  /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "🌍";

export type AdminCountry = { code: string; name: string; dial: string; region: string; flag: string; providers: string[] };
export type AdminUniversity = { id: string; name: string; shortName: string; city: string; countryCode: string; students: number | null; active: boolean };
export type Suggestion = { id: string; name: string; city: string; countryCode: string; note: string | null; suggesterName: string; createdAt: string };

type CountryRow = { code: string; name: string; dial_code: string; region: string | null; flag_emoji: string | null; mobile_money_providers: string[] };
type UniRow = { id: string; name: string; short_name: string; city: string; country_code: string; student_count: number | null; active: boolean };
type SugRow = { id: string; name: string; city: string; country_code: string; note: string | null; created_at: string; suggester: { full_name: string | null } | null };

const toCountry = (r: CountryRow): AdminCountry => ({ code: r.code.trim(), name: r.name, dial: r.dial_code, region: r.region ?? "", flag: r.flag_emoji ?? flagFromCode(r.code.trim()), providers: r.mobile_money_providers ?? [] });
const toUni = (r: UniRow): AdminUniversity => ({ id: r.id, name: r.name, shortName: r.short_name, city: r.city, countryCode: r.country_code.trim(), students: r.student_count, active: r.active });

export async function fetchAdminCountries(): Promise<AdminCountry[]> {
  const { data, error } = await requireSupabase().from("countries").select("code, name, dial_code, region, flag_emoji, mobile_money_providers").order("name");
  if (error) throw error;
  return ((data ?? []) as CountryRow[]).map(toCountry);
}
export async function fetchAdminUniversities(): Promise<AdminUniversity[]> {
  const { data, error } = await requireSupabase().from("universities").select("id, name, short_name, city, country_code, student_count, active").order("name").limit(1000);
  if (error) throw error;
  return ((data ?? []) as UniRow[]).map(toUni);
}
export async function fetchPendingSuggestions(): Promise<Suggestion[]> {
  const { data, error } = await requireSupabase().from("university_suggestions").select("id, name, city, country_code, note, created_at, suggester:profiles!suggested_by(full_name)").eq("status", "pending").order("created_at");
  if (error) throw error;
  return ((data ?? []) as unknown as SugRow[]).map((r) => ({ id: r.id, name: r.name, city: r.city, countryCode: r.country_code.trim(), note: r.note, suggesterName: r.suggester?.full_name?.trim() || "Étudiant", createdAt: r.created_at }));
}

export type UniversityDraft = { name: string; shortName: string; city: string; countryCode: string; students: string };
export type CountryDraft = { code: string; name: string; dial: string; region: string; providers: string[] };

const parseStudents = (s: string): number | null => { const d = s.replace(/\D/g, ""); return d ? Number(d) : null; };

/** Traduit les refus de la base en phrases claires ; tout le reste suit le traitement commun des erreurs. */
function translate(e: unknown): never {
  const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
  if (code === "23505") throw new UserFacingError("Cet élément existe déjà (même sigle dans le même pays, ou même code).");
  if (code === "23503") throw new UserFacingError("Des universités sont encore rattachées à ce pays.");
  throw e;
}

export async function saveUniversity(draft: UniversityDraft, id?: string): Promise<void> {
  const row = { name: draft.name.trim(), short_name: draft.shortName.trim(), city: draft.city.trim(), country_code: draft.countryCode, student_count: parseStudents(draft.students) };
  const sb = requireSupabase();
  const { data, error } = id ? await sb.from("universities").update(row).eq("id", id).select("id") : await sb.from("universities").insert(row).select("id");
  if (error) translate(error);
  if (!data || data.length === 0) throw new UserFacingError("Modification refusée : cette action est réservée aux administrateurs.");
}
export async function setUniversityActive(id: string, active: boolean): Promise<void> {
  const { data, error } = await requireSupabase().from("universities").update({ active }).eq("id", id).select("id");
  if (error) translate(error);
  if (!data || data.length === 0) throw new UserFacingError("Modification refusée : cette action est réservée aux administrateurs.");
}
export async function deleteUniversity(id: string): Promise<void> {
  const { data, error } = await requireSupabase().from("universities").delete().eq("id", id).select("id");
  if (error) translate(error);
  if (!data || data.length === 0) throw new UserFacingError("Suppression refusée : cette action est réservée aux administrateurs.");
}

export async function saveCountry(draft: CountryDraft, editing: boolean): Promise<void> {
  const code = draft.code.trim().toUpperCase();
  const row = { name: draft.name.trim(), dial_code: draft.dial.trim(), region: draft.region || null, mobile_money_providers: draft.providers };
  const sb = requireSupabase();
  const { data, error } = editing
    ? await sb.from("countries").update(row).eq("code", code).select("code")
    : await sb.from("countries").insert({ code, flag_emoji: flagFromCode(code), ...row }).select("code");
  if (error) translate(error);
  if (!data || data.length === 0) throw new UserFacingError("Modification refusée : cette action est réservée aux administrateurs.");
}
export async function deleteCountry(code: string): Promise<void> {
  const { data, error } = await requireSupabase().from("countries").delete().eq("code", code).select("code");
  if (error) translate(error);
  if (!data || data.length === 0) throw new UserFacingError("Suppression refusée : cette action est réservée aux administrateurs.");
}

const REVIEW_ERRORS: Record<string, string> = {
  forbidden: "Le traitement des suggestions est réservé aux administrateurs.",
  mfa_required: "Cette action exige une session sécurisée : validez votre code de double authentification (page Sécurité).",
  not_found: "Cette suggestion n'existe plus.",
  already_reviewed: "Cette suggestion a déjà été traitée.",
  short_name_required: "Indiquez le sigle de l'université (2 à 20 caractères).",
  invalid_student_count: "Le nombre d'étudiants doit être positif.",
  duplicate: "Une université du même nom ou du même sigle existe déjà dans ce pays.",
};

export async function reviewSuggestion(input: { id: string; approve: boolean; shortName?: string; students?: string }): Promise<void> {
  const { data, error } = await requireSupabase().rpc("admin_review_university_suggestion", {
    p_suggestion_id: input.id, p_approve: input.approve, p_short_name: input.shortName?.trim() || null, p_student_count: input.students ? parseStudents(input.students) : null,
  });
  if (error) throw error;
  const r = data as { success?: boolean; error?: string } | null;
  if (!r?.success) throw new UserFacingError(REVIEW_ERRORS[r?.error ?? ""] ?? "Action impossible.");
}

const enabled = () => getSupabase() !== null;
export const useAdminCountries = () => useQuery({ queryKey: ["admin-geo", "countries"], queryFn: fetchAdminCountries, enabled: enabled(), staleTime: 15_000 });
export const useAdminUniversities = () => useQuery({ queryKey: ["admin-geo", "universities"], queryFn: fetchAdminUniversities, enabled: enabled(), staleTime: 15_000 });
export const usePendingSuggestions = () => useQuery({ queryKey: ["admin-geo", "suggestions"], queryFn: fetchPendingSuggestions, enabled: enabled(), staleTime: 10_000 });

export function useGeoActions() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-geo"] });
    void qc.invalidateQueries({ queryKey: ["universities"] });
    void qc.invalidateQueries({ queryKey: ["countries"] });
    void qc.invalidateQueries({ queryKey: ["campuses"] });
    void qc.invalidateQueries({ queryKey: ["admin-stats"] });
  };
  return {
    saveUniversity: useMutation({ mutationFn: (v: { draft: UniversityDraft; id?: string | undefined }) => saveUniversity(v.draft, v.id), onSettled: refresh }),
    setActive: useMutation({ mutationFn: (v: { id: string; active: boolean }) => setUniversityActive(v.id, v.active), onSettled: refresh }),
    deleteUniversity: useMutation({ mutationFn: (id: string) => deleteUniversity(id), onSettled: refresh }),
    saveCountry: useMutation({ mutationFn: (v: { draft: CountryDraft; editing: boolean }) => saveCountry(v.draft, v.editing), onSettled: refresh }),
    deleteCountry: useMutation({ mutationFn: (code: string) => deleteCountry(code), onSettled: refresh }),
    review: useMutation({ mutationFn: (v: { id: string; approve: boolean; shortName?: string; students?: string }) => reviewSuggestion(v), onSettled: refresh }),
    errorText: (e: unknown, fallback = "Action impossible.") => friendlyError(e, fallback),
  };
}
