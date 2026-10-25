import { useQuery } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";

/** Pays et universités tels que la base les renvoie. */
export type Country = {
  code: string;
  name: string;
  dial: string;
  mobileMoney: string[];
  flag?: string;
};
export type University = {
  id: string;
  name: string;
  short: string;
  city: string;
  country: string;
  students: string;
};

type CountryRow = {
  code: string;
  name: string;
  dial_code: string;
  mobile_money_providers: string[];
  flag_emoji: string | null;
};
type UniversityRow = {
  id: string;
  name: string;
  short_name: string;
  city: string;
  country_code: string;
  student_count: number | null;
};

export function formatStudents(count: number | null): string {
  if (count == null) return "Effectif non renseigné";
  return `${count.toLocaleString("fr-FR")} étudiant${count > 1 ? "s" : ""}`;
}

/** Valeur initiale de l'inscription tant que la liste des pays n'est pas chargée. */
export const DEFAULT_COUNTRY: Country = {
  code: "CM",
  name: "Cameroun",
  dial: "+237",
  mobileMoney: ["MTN MoMo", "Orange Money"],
};

export async function fetchCountries(): Promise<Country[]> {
  const { data, error } = await requireSupabase()
    .from("countries")
    .select("code, name, dial_code, mobile_money_providers, flag_emoji")
    .order("name");
  if (error) throw error;
  return (data as CountryRow[]).map((c) => ({
    code: c.code.trim(),
    name: c.name,
    dial: c.dial_code,
    mobileMoney: c.mobile_money_providers,
    ...(c.flag_emoji ? { flag: c.flag_emoji } : {}),
  }));
}

export async function fetchUniversities(countryCode: string): Promise<University[]> {
  const { data, error } = await requireSupabase()
    .from("universities")
    .select("id, name, short_name, city, country_code, student_count")
    .eq("country_code", countryCode)
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return (data as UniversityRow[]).map((u) => ({
    id: u.id,
    name: u.name,
    short: u.short_name,
    city: u.city,
    country: u.country_code.trim(),
    students: formatStudents(u.student_count),
  }));
}

/** Référentiels publics (lisibles sans connexion : policies anon de 0002), donc rarement modifiés : cache long. */
export function useCountries() {
  return useQuery({
    queryKey: ["countries"],
    queryFn: fetchCountries,
    enabled: getSupabase() !== null,
    staleTime: 60 * 60 * 1000,
  });
}

export function useUniversities(countryCode: string) {
  return useQuery({
    queryKey: ["universities", countryCode],
    queryFn: () => fetchUniversities(countryCode),
    enabled: getSupabase() !== null && countryCode.length > 0,
    staleTime: 10 * 60 * 1000,
  });
}

/** Suggestion d'une université absente de la liste (0018 : file de validation côté admin). */
export async function suggestUniversity(input: {
  userId: string;
  name: string;
  city: string;
  countryCode: string;
}): Promise<void> {
  const { error } = await requireSupabase().from("university_suggestions").insert({
    suggested_by: input.userId,
    name: input.name.trim(),
    city: input.city.trim(),
    country_code: input.countryCode,
  });
  if (error) throw error;
}

export type CampusOption = { shortName: string; city: string };

/** Universités actives (sigle + ville) : choix du campus dans les formulaires (annonce, demande, événement). */
export async function fetchActiveCampuses(): Promise<CampusOption[]> {
  const { data, error } = await requireSupabase().from("universities").select("short_name, city").eq("active", true).order("short_name");
  if (error) throw error;
  return (data as { short_name: string; city: string }[]).map((u) => ({ shortName: u.short_name, city: u.city }));
}

export function useActiveCampuses() {
  return useQuery({
    queryKey: ["campuses", "active"],
    queryFn: fetchActiveCampuses,
    enabled: getSupabase() !== null,
    staleTime: 10 * 60 * 1000,
  });
}
