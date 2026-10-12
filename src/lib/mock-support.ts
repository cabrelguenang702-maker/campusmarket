import { Coin, Shield, Store, Ticket, User, type IconType } from "@/components/icons";
import type { ChatMessage } from "@/lib/mock-social";

export type FaqCategory = { id: string; name: string; icon: IconType };
export const faqCategories: FaqCategory[] = [
  { id: "compte", name: "Compte et profil", icon: User },
  { id: "paiements", name: "Paiements et Mobile Money", icon: Coin },
  { id: "billetterie", name: "Événements et billetterie", icon: Ticket },
  { id: "marketplace", name: "Achats et ventes", icon: Store },
  { id: "securite", name: "Sécurité et confiance", icon: Shield },
];

export type FaqItem = { id: string; category: string; question: string; answer: string };
export const faqItems: FaqItem[] = [
  { id: "f1", category: "compte", question: "Comment vérifier mon compte étudiant ?", answer: "Rendez-vous dans Profil > Vérification et importez votre carte d'étudiant en cours de validité. La vérification prend généralement moins de 24 heures." },
  { id: "f2", category: "compte", question: "Puis-je changer d'université après inscription ?", answer: "Oui, depuis Profil > Paramètres > Université. Un nouveau justificatif pourra être demandé pour confirmer votre changement d'établissement." },
  { id: "f3", category: "compte", question: "Comment supprimer mon compte ?", answer: "Depuis Profil > Paramètres > Confidentialité, en bas de page. Cette action est définitive et supprime vos annonces, messages et billets." },
  { id: "f4", category: "paiements", question: "Quels moyens de paiement sont acceptés ?", answer: "MTN Mobile Money, Orange Money et les autres solutions mobiles disponibles dans votre pays, affichées automatiquement selon votre numéro." },
  { id: "f5", category: "paiements", question: "Mon paiement a échoué, mais j'ai reçu un message de débit", answer: "Contactez-nous avec la référence de la transaction Mobile Money : nous vérifions et remboursons sous 48 heures si le paiement n'est pas arrivé jusqu'à CampusMarket." },
  { id: "f6", category: "paiements", question: "Comment fonctionne le paiement à la livraison ?", answer: "Disponible sur certaines annonces marquées « Paiement à la remise ». Vous payez en Mobile Money directement au vendeur au moment de la remise en main propre." },
  { id: "f7", category: "billetterie", question: "Je n'ai pas reçu mon billet après paiement", answer: "Votre billet électronique apparaît directement sur la page de l'événement, section « Mon billet ». Si rien ne s'affiche après paiement confirmé, ouvrez un ticket avec la référence de paiement." },
  { id: "f8", category: "billetterie", question: "Puis-je me faire rembourser un billet ?", answer: "Cela dépend de la politique de l'organisateur de l'événement, indiquée sur la page de l'événement. En cas d'annulation de l'événement, le remboursement est automatique." },
  { id: "f9", category: "billetterie", question: "Comment fonctionne le contrôle des billets à l'entrée ?", answer: "L'organisateur scanne le QR code de votre billet depuis l'application. Gardez votre billet accessible (capture d'écran ou téléchargement) même sans connexion." },
  { id: "f10", category: "marketplace", question: "Comment savoir si un vendeur est fiable ?", answer: "Consultez son badge de vérification, ses avis et son ancienneté sur son profil boutique. Privilégiez les remises en main propre sur le campus." },
  { id: "f11", category: "marketplace", question: "Comment fonctionne un achat groupé ?", answer: "Plusieurs acheteurs se regroupent sur une même annonce pour débloquer un prix réduit une fois un seuil de participants atteint." },
  { id: "f12", category: "marketplace", question: "Que faire si l'article reçu ne correspond pas à l'annonce ?", answer: "Contactez d'abord le vendeur via la messagerie. Si aucun accord n'est trouvé, ouvrez un ticket avec des photos : notre équipe peut intervenir sous 72 heures." },
  { id: "f13", category: "securite", question: "Comment signaler un utilisateur ou une annonce ?", answer: "Utilisez le bouton « Signaler » présent sur chaque profil, annonce ou conversation. Notre équipe de modération traite les signalements sous 24 à 48 heures." },
  { id: "f14", category: "securite", question: "Mes informations de paiement sont-elles visibles par les autres ?", answer: "Non, jamais. Seuls votre nom et votre campus sont visibles par vos correspondants ; vos numéros Mobile Money ne sont jamais partagés." },
];

export type TicketStatus = "ouvert" | "en_attente" | "resolu" | "ferme";
export type SupportTicket = {
  id: string; subject: string; category: string; status: TicketStatus;
  createdLabel: string; updatedLabel: string;
  messages: ChatMessage[];
};

export const ticketStatusLabel: Record<TicketStatus, string> = { ouvert: "Ouvert", en_attente: "En attente de votre réponse", resolu: "Résolu", ferme: "Fermé" };

export const tickets: SupportTicket[] = [
  {
    id: "t1", subject: "Paiement débité mais billet non reçu", category: "paiements", status: "en_attente",
    createdLabel: "Il y a 2 jours", updatedLabel: "Il y a 3 heures",
    messages: [
      { id: "m1", from: "me", time: "Lun. 09:12", status: "read", text: "Bonjour, j'ai payé 500 FCFA pour la Soirée de rentrée via MTN MoMo mais je n'ai pas reçu mon billet. Référence : MP240912.4471" },
      { id: "m2", from: "them", time: "Lun. 11:40", text: "Bonjour, merci pour ces détails. Nous vérifions la transaction auprès de l'opérateur, réponse sous 24h." },
      { id: "m3", from: "them", time: "Mar. 14:05", text: "Le paiement est bien confirmé de notre côté. Pouvez-vous rafraîchir la page de l'événement et nous dire si le billet apparaît maintenant ?" },
    ],
  },
  {
    id: "t2", subject: "Vendeur injoignable après achat", category: "marketplace", status: "ouvert",
    createdLabel: "Il y a 5 heures", updatedLabel: "Il y a 5 heures",
    messages: [
      { id: "m1", from: "me", time: "Aujourd'hui 08:30", status: "delivered", text: "J'ai acheté un livre de Physique mais le vendeur ne répond plus depuis 2 jours. Pouvez-vous m'aider ?" },
    ],
  },
  {
    id: "t3", subject: "Question sur la vérification étudiant", category: "compte", status: "resolu",
    createdLabel: "Il y a 8 jours", updatedLabel: "Il y a 6 jours",
    messages: [
      { id: "m1", from: "me", time: "12 sept. 16:20", status: "read", text: "Ma carte d'étudiant a expiré, puis-je quand même me faire vérifier ?" },
      { id: "m2", from: "them", time: "12 sept. 17:02", text: "Oui, un certificat de scolarité de l'année en cours fonctionne aussi. Pouvez-vous nous l'envoyer ?" },
      { id: "m3", from: "me", time: "13 sept. 09:15", status: "read", attachment: { kind: "file", name: "certificat-scolarite.pdf", size: "310 Ko" } },
      { id: "m4", from: "them", time: "14 sept. 10:00", text: "Parfait, votre compte est maintenant vérifié. Bonne continuation sur CampusMarket !" },
    ],
  },
  {
    id: "t4", subject: "Demande de suppression de compte", category: "compte", status: "ferme",
    createdLabel: "Il y a 20 jours", updatedLabel: "Il y a 18 jours",
    messages: [
      { id: "m1", from: "me", time: "3 sept. 10:00", status: "read", text: "Je change d'université, comment supprimer mon compte actuel ?" },
      { id: "m2", from: "them", time: "3 sept. 15:30", text: "Vous pouvez le faire vous-même depuis Profil > Paramètres > Confidentialité. N'hésitez pas si vous rencontrez un souci." },
      { id: "m3", from: "me", time: "5 sept. 08:00", status: "read", text: "C'est fait, merci beaucoup !" },
    ],
  },
];

export function getTicket(id: string): SupportTicket | undefined {
  return tickets.find((t) => t.id === id);
}
