import { useQuery } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { fetchCampusEvents } from "./events";
import { fetchCampusListings } from "./products";
import { formatStudents } from "./geo";

/* Annuaire des universités (lecture publique : politiques universities_select_public et countries_select_public) et activité
 * de chaque campus. Le campus d'une annonce ou d'un événement est le SIGLE de l'université (short_name). */

export type DirectoryUniversity = {
  id: string; name: string; short: string; city: string; country: string; countryName: string; flag: string; region: string; students: string; studentCount: number | null;
};

const SELECT = "id, name, short_name, city, country_code, student_count, country:countries!country_code(name, flag_emoji, region)";
type Row = {
  id: string; name: string; short_name: string; city: string; country_code: string; student_count: number | null;
  country: { name: string; flag_emoji: string | null; region: string | null } | { name: string; flag_emoji: string | null; region: string | null }[] | null;
};

function toUniversity(r: Row): DirectoryUniversity {
  const c = Array.isArray(r.country) ? r.country[0] : r.country;
  const code = r.country_code.trim();
  return { id: r.id, name: r.name, short: r.short_name, city: r.city, country: code, countryName: c?.name ?? code, flag: c?.flag_emoji ?? "", region: c?.region ?? "", students: formatStudents(r.student_count), studentCount: r.student_count };
}

export async function fetchDirectory(): Promise<DirectoryUniversity[]> {
  const { data, error } = await requireSupabase().from("universities").select(SELECT).eq("active", true).order("name");
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(toUniversity);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function fetchUniversity(id: string): Promise<DirectoryUniversity | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await requireSupabase().from("universities").select(SELECT).eq("id", id).eq("active", true).maybeSingle();
  if (error) throw error;
  return data ? toUniversity(data as unknown as Row) : null;
}

export function useDirectory() {
  return useQuery({ queryKey: ["universities", "directory"], queryFn: fetchDirectory, enabled: getSupabase() !== null, staleTime: 10 * 60_000 });
}
export function useUniversity(id: string) {
  return useQuery({ queryKey: ["universities", "one", id], queryFn: () => fetchUniversity(id), enabled: getSupabase() !== null, staleTime: 5 * 60_000 });
}
/** Annonces et événements actifs d'un campus (par sigle). Chacun se charge indépendamment : l'un peut échouer sans masquer l'autre. */
export function useCampusListings(short: string | undefined) {
  return useQuery({ queryKey: ["universities", "listings", short], queryFn: () => fetchCampusListings(short!, 4), enabled: !!short && getSupabase() !== null, staleTime: 60_000 });
}
export function useCampusEvents(short: string | undefined) {
  return useQuery({ queryKey: ["universities", "events", short], queryFn: () => fetchCampusEvents(short!), enabled: !!short && getSupabase() !== null, staleTime: 60_000 });
}
