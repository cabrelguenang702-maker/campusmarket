import { universities } from "@/lib/mock-data";
import { products } from "@/lib/mock-data";
import { events } from "@/lib/mock-events";
import { tickets } from "@/lib/mock-support";

export type UserStatus = "actif" | "suspendu" | "banni";
export type AdminUser = {
  id: string; name: string; email: string; campus: string; status: UserStatus; verified: boolean;
  joinedLabel: string; listingsCount: number; reportsCount: number;
};

export const adminUsers: AdminUser[] = [
  { id: "u1", name: "Grace Ekane", email: "grace.ekane@etu.uy1.cm", campus: "UY1", status: "actif", verified: true, joinedLabel: "12 janv. 2026", listingsCount: 7, reportsCount: 0 },
  { id: "u2", name: "Kevin Fotso", email: "kevin.fotso@etu.iutfv.cm", campus: "IUT FV", status: "actif", verified: true, joinedLabel: "3 févr. 2026", listingsCount: 3, reportsCount: 0 },
  { id: "u3", name: "Marie Tchoua", email: "marie.tchoua@etu.uy1.cm", campus: "UY1", status: "actif", verified: false, joinedLabel: "20 févr. 2026", listingsCount: 1, reportsCount: 0 },
  { id: "u4", name: "Paul Ndzana", email: "paul.ndzana@etu.udo.cm", campus: "UDo", status: "suspendu", verified: true, joinedLabel: "5 mars 2026", listingsCount: 12, reportsCount: 3 },
  { id: "u5", name: "Yannick Bell", email: "yannick.bell@etu.uy1.cm", campus: "UY1", status: "actif", verified: true, joinedLabel: "18 mars 2026", listingsCount: 5, reportsCount: 1 },
  { id: "u6", name: "Ines Kamga", email: "ines.kamga@etu.uds.cm", campus: "UDs", status: "actif", verified: false, joinedLabel: "2 avr. 2026", listingsCount: 0, reportsCount: 0 },
  { id: "u7", name: "Ruth Nkeng", email: "ruth.nkeng@etu.ub.cm", campus: "UB", status: "banni", verified: false, joinedLabel: "14 avr. 2026", listingsCount: 2, reportsCount: 6 },
  { id: "u8", name: "Sandra Fon", email: "sandra.fon@etu.iutfv.cm", campus: "IUT FV", status: "actif", verified: true, joinedLabel: "9 mai 2026", listingsCount: 9, reportsCount: 0 },
  { id: "u9", name: "Brice Tagne", email: "brice.tagne@etu.enspy.cm", campus: "ENSPY", status: "actif", verified: true, joinedLabel: "22 mai 2026", listingsCount: 4, reportsCount: 0 },
  { id: "u10", name: "Mireille Abena", email: "mireille.abena@etu.uy1.cm", campus: "UY1", status: "actif", verified: true, joinedLabel: "30 mai 2026", listingsCount: 15, reportsCount: 1 },
];

export type ReportStatus = "en_attente" | "traite" | "rejete";
export type Report = { id: string; kind: "annonce" | "utilisateur" | "message"; targetLabel: string; reason: string; reporterName: string; createdLabel: string; status: ReportStatus };

export const reports: Report[] = [
  { id: "r1", kind: "annonce", targetLabel: "iPhone 13 Pro Max — comme neuf", reason: "Annonce suspecte : prix anormalement bas", reporterName: "Yannick Bell", createdLabel: "Il y a 2 heures", status: "en_attente" },
  { id: "r2", kind: "utilisateur", targetLabel: "Paul Ndzana", reason: "Ne répond pas après paiement reçu", reporterName: "Sandra Fon", createdLabel: "Il y a 5 heures", status: "en_attente" },
  { id: "r3", kind: "message", targetLabel: "Conversation #c3", reason: "Propos déplacés en messagerie", reporterName: "Ines Kamga", createdLabel: "Il y a 1 jour", status: "en_attente" },
  { id: "r4", kind: "utilisateur", targetLabel: "Ruth Nkeng", reason: "Comptes multiples suspectés", reporterName: "Modération automatique", createdLabel: "Il y a 3 jours", status: "traite" },
  { id: "r5", kind: "annonce", targetLabel: "Cours particuliers — tous niveaux", reason: "Publicité hors marketplace autorisée", reporterName: "Grace Ekane", createdLabel: "Il y a 4 jours", status: "rejete" },
];

export type AdminAlert = { id: string; tone: "warning" | "danger" | "info"; title: string; description: string; time: string };
export const alerts: AdminAlert[] = [
  { id: "a1", tone: "danger", title: "Pic de signalements sur un utilisateur", description: "Ruth Nkeng a reçu 6 signalements en 24 heures.", time: "Il y a 1 heure" },
  { id: "a2", tone: "warning", title: "Taux d'échec de paiement élevé", description: "12 % des paiements Mobile Money ont échoué hier soir, au-dessus du seuil habituel.", time: "Il y a 6 heures" },
  { id: "a3", tone: "info", title: "Nouvelle université en attente de validation", description: "Une université a été suggérée par un étudiant lors de l'inscription.", time: "Il y a 1 jour" },
];

export const weeklyActivity = [
  { day: "Lun", inscriptions: 24, annonces: 41 },
  { day: "Mar", inscriptions: 31, annonces: 38 },
  { day: "Mer", inscriptions: 28, annonces: 52 },
  { day: "Jeu", inscriptions: 35, annonces: 47 },
  { day: "Ven", inscriptions: 42, annonces: 60 },
  { day: "Sam", inscriptions: 19, annonces: 33 },
  { day: "Dim", inscriptions: 15, annonces: 22 },
];

export function dashboardStats() {
  return {
    users: 12480 + adminUsers.length,
    universities: universities.length,
    listings: products.length,
    events: events.length,
    openTickets: tickets.filter((t) => t.status === "ouvert" || t.status === "en_attente").length,
    pendingReports: reports.filter((r) => r.status === "en_attente").length,
    revenueFcfa: 4_280_000,
  };
}

export function getAdminUser(id: string): AdminUser | undefined {
  return adminUsers.find((u) => u.id === id);
}
