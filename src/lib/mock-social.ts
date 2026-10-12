import {
  Bell, CalendarDays, GraduationCap, MessageCircle, ShoppingBag, Tag, Users, Ticket, type IconType,
} from "@/components/icons";
import { sellers } from "./mock-data";

/* ---------- Profil de l'utilisateur connecté ---------- */
export const me = {
  id: "jean-dupont",
  name: "Jean Dupont",
  username: "@jeandupont",
  bio: "Étudiant en informatique. Je revends mon matériel en bon état et réponds vite aux messages.",
  filiere: "Informatique",
  niveau: "Master 1",
  campus: "IUT FV",
  university: "IUT Fotso Victor de Bandjoun",
  ville: "Bandjoun",
  phone: "+237 6 99 88 77 66",
  email: "jean.dupont@exemple.cm",
  since: "Membre depuis mars 2025",
  verified: true,
  stats: { annonces: 14, ventes: 38, achats: 9, note: 4.8 },
};

/* ---------- Annuaire (recherche d'utilisateur) ---------- */
export type Person = { id: string; name: string; campus: string; verified: boolean };

export const directory: Person[] = [
  ...sellers.filter((s) => s.id !== me.id).map((s) => ({ id: s.id, name: s.name, campus: s.campus, verified: s.verified })),
  { id: "ruth-nkeng", name: "Ruth Nkeng", campus: "UY1 · Yaoundé", verified: true },
  { id: "patrick-essomba", name: "Patrick Essomba", campus: "UDo · Douala", verified: false },
  { id: "sandra-fon", name: "Sandra Fon", campus: "UB · Buea", verified: true },
  { id: "brice-tagne", name: "Brice Tagne", campus: "UDs · Dschang", verified: false },
  { id: "mireille-abena", name: "Mireille Abena", campus: "UY2 · Soa", verified: true },
];

/* ---------- Messagerie ---------- */
export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed" | "queued";
export type Attachment = { kind: "image" | "file"; name: string; size: string };
export type ChatMessage = { id: string; from: "me" | "them"; text?: string; time: string; status?: MessageStatus; attachment?: Attachment };
export type Conversation = {
  id: string; personId: string; name: string; campus: string; online: boolean; verified: boolean;
  productId?: string; last: string; time: string; unread: number; archived?: boolean; messages: ChatMessage[];
};

export const conversations: Conversation[] = [
  { id: "c1", personId: "aicha-mbarga", name: "Aïcha Mbarga", campus: "UDB · Douala", online: true, verified: true, productId: "iphone-13", last: "Vous pouvez passer demain à la bibliothèque, vers 14 h ?", time: "09:45", unread: 2,
    messages: [
      { id: "m1", from: "me", text: "Bonjour, le iPhone 13 est-il toujours disponible ?", time: "09:40", status: "read" },
      { id: "m2", from: "them", text: "Bonjour ! Oui, il est toujours disponible.", time: "09:44" },
      { id: "m3", from: "them", text: "Vous pouvez passer demain à la bibliothèque, vers 14 h ?", time: "09:45" },
    ] },
  { id: "c2", personId: "kevin-fotso", name: "Kevin Fotso", campus: "IUC · Douala", online: false, verified: false, productId: "casque-jbl", last: "Ok pour demain à la cafétéria.", time: "Hier", unread: 1,
    messages: [
      { id: "m1", from: "me", text: "Salut Kevin, je prends le casque JBL. On se voit où ?", time: "Hier 16:02", status: "read" },
      { id: "m2", from: "them", text: "Salut ! À la cafétéria centrale, en fin de journée ?", time: "Hier 16:20" },
      { id: "m3", from: "me", text: "Parfait, à 17 h alors.", time: "Hier 16:22", status: "read" },
      { id: "m4", from: "them", text: "Ok pour demain à la cafétéria.", time: "Hier 18:05" },
    ] },
  { id: "c3", personId: "marie-tchoua", name: "Marie Tchoua", campus: "UDs · Dschang", online: true, verified: true, productId: "hp-probook", last: "Photo envoyée", time: "Lun.", unread: 0,
    messages: [
      { id: "m1", from: "me", text: "Bonjour, pouvez-vous m'envoyer une photo du clavier ?", time: "Lun. 11:10", status: "read" },
      { id: "m2", from: "them", time: "Lun. 11:32", attachment: { kind: "image", name: "clavier-probook.jpg", size: "1,2 Mo" } },
      { id: "m3", from: "them", text: "Voilà, le clavier est en très bon état.", time: "Lun. 11:32" },
      { id: "m4", from: "me", time: "Lun. 11:40", status: "read", attachment: { kind: "file", name: "recu-reservation.pdf", size: "84 Ko" } },
    ] },
  { id: "c4", personId: "paul-ndzana", name: "Paul Ndzana", campus: "UY2 · Soa", online: false, verified: false, productId: "pack-manuels-l1", last: "Merci, bonne journée !", time: "Dim.", unread: 0,
    messages: [
      { id: "m1", from: "them", text: "Le pack de manuels est toujours là si ça vous intéresse.", time: "Dim. 09:12" },
      { id: "m2", from: "me", text: "Merci, je repasse la semaine prochaine.", time: "Dim. 09:30", status: "read" },
      { id: "m3", from: "them", text: "Merci, bonne journée !", time: "Dim. 09:31" },
    ] },
  { id: "c5", personId: "ines-kamga", name: "Inès Kamga", campus: "UDo · Douala", online: true, verified: true, productId: "cours-maths", last: "Séance confirmée pour jeudi 16 h.", time: "12 sept.", unread: 0, archived: true,
    messages: [
      { id: "m1", from: "me", text: "Bonjour, avez-vous une disponibilité jeudi ?", time: "12 sept. 08:00", status: "read" },
      { id: "m2", from: "them", text: "Séance confirmée pour jeudi 16 h.", time: "12 sept. 08:14" },
    ] },
];

export function getConversation(id: string): Conversation | undefined {
  return conversations.find((c) => c.id === id);
}

/** Conversation vide créée depuis « Nouvelle conversation » (id `u-<personId>`). */
export function emptyConversationFor(personId: string): Conversation | undefined {
  const person = directory.find((p) => p.id === personId);
  if (!person) return undefined;
  return { id: `u-${person.id}`, personId: person.id, name: person.name, campus: person.campus, online: false, verified: person.verified, last: "", time: "", unread: 0, messages: [] };
}

/* ---------- Notifications ---------- */
export type NotifType = "produit" | "message" | "achat" | "groupe" | "evenement" | "formation" | "systeme";
export type NotifTone = "primary" | "success" | "warning" | "info" | "neutral";

export const notifMeta: Record<NotifType, { label: string; icon: IconType; tone: NotifTone }> = {
  produit: { label: "Produits", icon: Tag, tone: "primary" },
  message: { label: "Messages", icon: MessageCircle, tone: "info" },
  achat: { label: "Achats et ventes", icon: ShoppingBag, tone: "success" },
  groupe: { label: "Groupes", icon: Users, tone: "primary" },
  evenement: { label: "Événements", icon: Ticket, tone: "warning" },
  formation: { label: "Formations", icon: GraduationCap, tone: "info" },
  systeme: { label: "Système", icon: Bell, tone: "neutral" },
};

export type NotificationItem = { id: string; type: NotifType; title: string; body: string; time: string; group: "aujourdhui" | "hier" | "avant"; unread: boolean; to: string };

export const notifications: NotificationItem[] = [
  { id: "n1", type: "message", title: "Aïcha Mbarga", body: "Vous pouvez passer demain à la bibliothèque, vers 14 h ?", time: "2 min", group: "aujourdhui", unread: true, to: "/messages/c1" },
  { id: "n2", type: "achat", title: "Commande confirmée", body: "Casque JBL Tune — paiement reçu.", time: "1 h", group: "aujourdhui", unread: true, to: "/profil?onglet=achats" },
  { id: "n3", type: "produit", title: "Baisse de prix", body: "MacBook Air M2, dans vos favoris, passe à 430 000 FCFA.", time: "2 h", group: "aujourdhui", unread: true, to: "/produit/macbook-air-m2" },
  { id: "n4", type: "groupe", title: "Palier atteint !", body: "Achat groupé Casque JBL : 10 participants, prix à 21 000 FCFA.", time: "3 h", group: "aujourdhui", unread: true, to: "/produit/casque-jbl/achat-groupe" },
  { id: "n5", type: "evenement", title: "Hackathon Campus 2026", body: "Votre billet électronique est prêt.", time: "5 h", group: "aujourdhui", unread: false, to: "/evenements/hackathon-campus-2026" },
  { id: "n6", type: "formation", title: "Formation terminée", body: "Design UI avec Figma — votre certificat est disponible.", time: "Hier", group: "hier", unread: true, to: "/formations/design-ui-figma/certificat" },
  { id: "n7", type: "systeme", title: "Nouvelle connexion", body: "Connexion depuis Chrome à Douala. Ce n'était pas vous ? Sécurisez votre compte.", time: "Hier", group: "hier", unread: false, to: "/profil/parametres?section=securite" },
  { id: "n8", type: "produit", title: "De nouveau disponible", body: "HP ProBook 450 G8 est de nouveau en vente.", time: "Hier", group: "hier", unread: false, to: "/produit/hp-probook" },
  { id: "n9", type: "message", title: "Kevin Fotso", body: "Ok pour demain à la cafétéria.", time: "Hier", group: "hier", unread: false, to: "/messages/c2" },
  { id: "n10", type: "achat", title: "Vente réalisée", body: "Pack manuels Licence 1 a été acheté par Paul N.", time: "Dim.", group: "avant", unread: false, to: "/profil?onglet=ventes" },
  { id: "n11", type: "groupe", title: "Groupe complet", body: "Écouteurs sans fil : l'objectif de 20 participants est atteint.", time: "Sam.", group: "avant", unread: false, to: "/produit/ecouteurs-sans-fil/achat-groupe" },
  { id: "n12", type: "evenement", title: "Rappel", body: "Soirée de rentrée — demain à 18 h, amphi 250.", time: "Sam.", group: "avant", unread: false, to: "/evenements" },
  { id: "n13", type: "formation", title: "Nouveau module", body: "Introduction à React — le module 4 est disponible.", time: "Ven.", group: "avant", unread: false, to: "/formations" },
  { id: "n14", type: "systeme", title: "Conditions d'utilisation", body: "Nous avons mis à jour nos conditions d'utilisation.", time: "12 sept.", group: "avant", unread: false, to: "/aide" },
];

export const previewNotifications = notifications.slice(0, 4).map((n) => ({ id: n.id, icon: notifMeta[n.type].icon, title: n.title, body: n.body, time: n.time, unread: n.unread }));

/* ---------- Activité du profil ---------- */
export type OrderStatus = "encours" | "confirmee" | "livree" | "annulee";
export type Order = { id: string; productId: string; counterpart: string; date: string; total: number; status: OrderStatus };

export const purchases: Order[] = [
  { id: "CM-CMD-2026-0187", productId: "casque-jbl", counterpart: "Kevin Fotso", date: "20 sept. 2026", total: 25500, status: "confirmee" },
  { id: "CM-CMD-2026-0164", productId: "pack-manuels-l1", counterpart: "Paul Ndzana", date: "12 sept. 2026", total: 18360, status: "livree" },
  { id: "CM-CMD-2026-0121", productId: "calculatrice", counterpart: "Yannick Bell", date: "2 sept. 2026", total: 12240, status: "livree" },
  { id: "CM-CMD-2026-0098", productId: "lampe-bureau", counterpart: "Kevin Fotso", date: "28 août 2026", total: 8160, status: "annulee" },
];

export const sales: Order[] = [
  { id: "CM-VTE-2026-0044", productId: "ecouteurs-sans-fil", counterpart: "Marie Tchoua", date: "19 sept. 2026", total: 15000, status: "encours" },
  { id: "CM-VTE-2026-0039", productId: "macbook-air-m2", counterpart: "Ruth Nkeng", date: "10 sept. 2026", total: 430000, status: "livree" },
  { id: "CM-VTE-2026-0031", productId: "sac-a-dos", counterpart: "Sandra Fon", date: "1 sept. 2026", total: 12000, status: "livree" },
];

export const myCommunities = [
  { id: "developpeurs-cameroun", name: "Développeurs Cameroun", members: "8 240 membres", role: "Membre" },
  { id: "entrepreneurs-campus", name: "Entrepreneurs du campus", members: "1 120 membres", role: "Modérateur" },
];
export const myGroups = [
  { id: "iutfv-informatique", name: "IUT FV · Informatique M1", members: "46 membres", role: "Administrateur" },
  { id: "bons-plans-bandjoun", name: "Bons plans Bandjoun", members: "312 membres", role: "Membre" },
];
export const myEvents = [
  { id: "hackathon-campus-2026", name: "Hackathon Campus 2026", date: "Sam. 26 sept. · 09:00", place: "Université de Yaoundé I", ticket: true },
  { id: "soiree-rentree", name: "Soirée de rentrée", date: "Ven. 2 oct. · 18:00", place: "Amphi 250 · IUT FV", ticket: false },
];

/* ---------- Appareils et connexions ---------- */
export const devices = [
  { id: "d1", name: "Chrome sur Windows", place: "Bandjoun, Cameroun", last: "Session actuelle", current: true, kind: "desktop" as const },
  { id: "d2", name: "Application Android (Tecno Camon 20)", place: "Bandjoun, Cameroun", last: "Il y a 5 minutes", current: false, kind: "mobile" as const },
  { id: "d3", name: "Safari sur iPhone", place: "Douala, Cameroun", last: "Il y a 3 jours", current: false, kind: "mobile" as const },
];

export const loginHistory = [
  { id: "l1", when: "Aujourd'hui, 08:12", what: "Chrome sur Windows", place: "Bandjoun", ok: true },
  { id: "l2", when: "Hier, 19:40", what: "Application Android", place: "Bandjoun", ok: true },
  { id: "l3", when: "Hier, 03:15", what: "Firefox sur Linux", place: "Lagos, Nigéria", ok: false },
  { id: "l4", when: "18 sept., 14:02", what: "Safari sur iPhone", place: "Douala", ok: true },
];

export const myRequests = [
  { id: "mr1", title: "Tablette graphique pour dessin", budget: 80000, responses: 3, status: "ouverte" as const, posted: "il y a 2 j", category: "ordinateurs" as const },
  { id: "mr2", title: "Manuels de génie logiciel M1", budget: 25000, responses: 1, status: "pourvue" as const, posted: "il y a 3 sem", category: "livres" as const },
];
