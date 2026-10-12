/**
 * Feuille de route des écrans du master (document « Master list des pages visuelles »).
 * Tant qu'une route n'est pas construite, elle affiche l'écran « en cours de conception »
 * (voir routes/_app.$.tsx). Chaque phase construite retire ses entrées de cette liste.
 */
export type Phase = { id: number; title: string; status: "done" | "next" | "todo" };

export const phases: Phase[] = [
  { id: 1, title: "Design System et composants globaux", status: "done" },
  { id: 2, title: "Authentification et onboarding", status: "done" },
  { id: 3, title: "Marketplace, produit, vendeur et checkout", status: "done" },
  { id: 4, title: "Messagerie, profil, favoris et notifications", status: "done" },
  { id: 5, title: "Academy / formations", status: "done" },
  { id: 6, title: "Communautés, groupes et événements", status: "done" },
  { id: 7, title: "Annuaire et support", status: "done" },
  { id: 8, title: "Back-office administrateur", status: "done" },
  { id: 9, title: "États d'erreur, chargement, vide et responsive", status: "done" },
  { id: 10, title: "Connexion aux routes et au backend existants", status: "next" },
];

export type PlannedRoute = { pattern: string; title: string; phase: number; screens: number; scope: string };

export const plannedRoutes: PlannedRoute[] = [];

function toRegex(pattern: string) {
  return new RegExp(`^${pattern.replace(/:[^/]+/g, "[^/]+")}/?$`);
}

export function findPlannedRoute(pathname: string): PlannedRoute | undefined {
  return plannedRoutes.find((r) => toRegex(r.pattern).test(pathname));
}
