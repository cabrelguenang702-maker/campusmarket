import { universities, countries, products, type University } from "@/lib/mock-data";
import { events } from "@/lib/mock-events";

export const regionsByCountry: Record<string, string> = {
  CM: "Afrique centrale", GA: "Afrique centrale", CD: "Afrique centrale", CG: "Afrique centrale",
  SN: "Afrique de l'Ouest", CI: "Afrique de l'Ouest", BJ: "Afrique de l'Ouest", TG: "Afrique de l'Ouest", BF: "Afrique de l'Ouest", ML: "Afrique de l'Ouest", GN: "Afrique de l'Ouest",
  MA: "Afrique du Nord",
};

export const flagByCountry: Record<string, string> = {
  CM: "🇨🇲", CI: "🇨🇮", SN: "🇸🇳", GA: "🇬🇦", CD: "🇨🇩", BJ: "🇧🇯", TG: "🇹🇬", BF: "🇧🇫", ML: "🇲🇱", GN: "🇬🇳", CG: "🇨🇬", MA: "🇲🇦",
};

export const regions = Array.from(new Set(countries.map((c) => regionsByCountry[c.code]).filter(Boolean))) as string[];

export function countryName(code: string): string {
  return countries.find((c) => c.code === code)?.name ?? code;
}

export function universityCity(u: University): string {
  return u.city;
}

/** Annonces et événements actifs sur ce campus, à partir des données déjà construites dans les autres modules. */
export function campusActivity(u: University) {
  const campusProducts = products.filter((p) => p.campus === u.short);
  const campusEvents = events.filter((e) => e.campus === u.short && e.status !== "termine" && e.status !== "annule");
  return { products: campusProducts, events: campusEvents };
}

export function getUniversity(id: string): University | undefined {
  return universities.find((u) => u.id === id);
}
