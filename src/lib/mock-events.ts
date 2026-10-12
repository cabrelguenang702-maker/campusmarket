import { Briefcase, Football, Laptop, Music, Palette, type IconType } from "@/components/icons";

export type EventStatus = "a-venir" | "complet" | "annule" | "termine";

export type ProgramItem = { time: string; title: string };

export type EventItem = {
  id: string;
  name: string;
  category: string;
  tone: string;
  icon: IconType;
  dateLabel: string;
  place: string;
  campus: string;
  city: string;
  organizer: string;
  description: string;
  /** 0 = événement gratuit. */
  price: number;
  capacity: number;
  /** Places déjà prises par d'autres participants (démo). */
  taken: number;
  program: ProgramItem[];
  status: EventStatus;
};

export const eventCategories = ["Technologie", "Vie de campus", "Carrière", "Sport", "Culture"];

export const events: EventItem[] = [
  {
    id: "hackathon-campus-2026", name: "Hackathon Campus 2026", category: "Technologie",
    tone: "from-cyan-400/30 to-blue-900/30", icon: Laptop,
    dateLabel: "Sam. 26 sept. · 09:00", place: "Amphithéâtre 200", campus: "UY1", city: "Yaoundé",
    organizer: "Développeurs Cameroun",
    description: "48 heures pour concevoir un prototype qui répond à un vrai problème du campus. Équipes de 3 à 5 personnes, mentors présents toute la durée, prix pour les trois meilleures équipes.",
    price: 0, capacity: 120, taken: 96,
    program: [
      { time: "Sam. 09:00", title: "Accueil et formation des équipes" },
      { time: "Sam. 10:00", title: "Annonce du thème" },
      { time: "Sam. 13:00", title: "Déjeuner" },
      { time: "Dim. 09:00", title: "Reprise du développement" },
      { time: "Dim. 15:00", title: "Présentations devant le jury" },
      { time: "Dim. 17:00", title: "Remise des prix" },
    ],
    status: "a-venir",
  },
  {
    id: "soiree-rentree", name: "Soirée de rentrée", category: "Vie de campus",
    tone: "from-fuchsia-400/30 to-blue-900/30", icon: Music,
    dateLabel: "Ven. 2 oct. · 18:00", place: "Amphi 250", campus: "IUT FV", city: "Bandjoun",
    organizer: "Vie étudiante à Bandjoun",
    description: "Musique, jeux et petite restauration pour bien démarrer l'année entre étudiants de tous niveaux. Billet à retirer à l'entrée avec votre code.",
    price: 500, capacity: 300, taken: 214,
    program: [
      { time: "18:00", title: "Ouverture des portes" },
      { time: "19:00", title: "Animations et jeux" },
      { time: "21:00", title: "Concert live" },
      { time: "23:00", title: "Clôture" },
    ],
    status: "a-venir",
  },
  {
    id: "forum-emplois-tech", name: "Forum emplois tech", category: "Carrière",
    tone: "from-emerald-400/30 to-teal-900/30", icon: Briefcase,
    dateLabel: "Mer. 14 oct. · 09:00", place: "Hall des sciences", campus: "UY1", city: "Yaoundé",
    organizer: "Entrepreneurs du campus",
    description: "Rencontrez des recruteurs d'entreprises technologiques camerounaises et internationales. CV et lettre de motivation conseillés, entretiens flash sur place.",
    price: 0, capacity: 150, taken: 150,
    program: [
      { time: "09:00", title: "Accueil des participants" },
      { time: "10:00", title: "Stands des entreprises" },
      { time: "13:00", title: "Ateliers CV et entretien" },
      { time: "16:00", title: "Clôture" },
    ],
    status: "complet",
  },
  {
    id: "tournoi-foot-uy1", name: "Tournoi foot inter-facultés", category: "Sport",
    tone: "from-lime-400/30 to-emerald-900/30", icon: Football,
    dateLabel: "Dim. 4 oct. · 15:00", place: "Terrain annexe", campus: "UY1", city: "Yaoundé",
    organizer: "Foot campus UY1",
    description: "Tournoi à élimination directe entre les facultés. Chaque équipe doit compter au moins deux étudiantes. Inscription par équipe de 8 joueurs.",
    price: 200, capacity: 80, taken: 47,
    program: [
      { time: "15:00", title: "Quarts de finale" },
      { time: "16:30", title: "Demi-finales" },
      { time: "17:30", title: "Finale" },
      { time: "18:15", title: "Remise du trophée" },
    ],
    status: "a-venir",
  },
  {
    id: "expo-photographes-campus", name: "Exposition photo du campus", category: "Culture",
    tone: "from-violet-400/30 to-blue-900/30", icon: Palette,
    dateLabel: "Sam. 6 sept. · 10:00", place: "Galerie du campus", campus: "IUT FV", city: "Bandjoun",
    organizer: "Photographes du campus",
    description: "Une sélection des meilleurs clichés pris par les étudiants pendant l'année écoulée.",
    price: 0, capacity: 60, taken: 60,
    program: [
      { time: "10:00", title: "Ouverture de l'exposition" },
      { time: "15:00", title: "Rencontre avec les photographes" },
    ],
    status: "termine",
  },
];

export function getEvent(id: string): EventItem | undefined {
  return events.find((e) => e.id === id);
}

/** Places restantes, jamais négatif. */
export function remaining(event: EventItem): number {
  return Math.max(0, event.capacity - event.taken);
}

/** Codes de billets de démonstration pour le contrôle d'accès (hors « moi »). */
export type Attendee = { code: string; name: string };

const demoNames = ["Aïcha Mbarga", "Kevin Fotso", "Marie Tchoua", "Paul Ndzana", "Yannick Bell", "Ines Kamga", "Ruth Nkeng", "Sandra Fon", "Brice Tagne", "Grace Ekane", "Patrick Essomba", "Mireille Abena"];

export function demoAttendees(event: EventItem): Attendee[] {
  const count = Math.min(12, Math.max(4, Math.round(event.taken / 8)));
  return Array.from({ length: count }, (_, i) => ({
    code: `CM-${event.id.slice(0, 4).toUpperCase()}-${String(i + 1).padStart(3, "0")}`,
    name: demoNames[i % demoNames.length]!,
  }));
}
