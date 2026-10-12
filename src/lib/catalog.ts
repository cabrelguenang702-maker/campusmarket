import type { Condition } from "./domain";

/* Filtres et tris de la marketplace. Le filtrage, le tri et la pagination se font côté serveur
 * (lib/api/products.ts, vue marketplace_listings) : ce fichier ne décrit que l'état des contrôles. */

export const PRICE_MAX = 500000;

export type Tri = "pertinence" | "recent" | "prix-asc" | "prix-desc" | "note";

export const sortOptions: { id: Tri; label: string }[] = [
  { id: "pertinence", label: "Pertinence" },
  { id: "recent", label: "Plus récentes" },
  { id: "prix-asc", label: "Prix croissant" },
  { id: "prix-desc", label: "Prix décroissant" },
  { id: "note", label: "Mieux notées" },
];

export type Filters = {
  min: number;
  max: number;
  etats: Condition[];
  campus: string;
  dispo: boolean;
  verifie: boolean;
  negociable: boolean;
  noteMin: number;
  fraicheur: "tous" | "1" | "7" | "30";
};

export const defaultFilters: Filters = { min: 0, max: PRICE_MAX, etats: [], campus: "tous", dispo: false, verifie: false, negociable: false, noteMin: 0, fraicheur: "tous" };

export function countActiveFilters(f: Filters) {
  return [f.min > 0 || f.max < PRICE_MAX, f.etats.length > 0, f.campus !== "tous", f.dispo, f.verifie, f.negociable, f.noteMin > 0, f.fraicheur !== "tous"].filter(Boolean).length;
}
