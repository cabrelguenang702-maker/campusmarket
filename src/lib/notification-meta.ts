import { Bell, GraduationCap, MessageCircle, ShieldCheck, ShoppingBag, Tag, Ticket, Users, type IconType } from "@/components/icons";
import type { NotifCategory } from "./api/notifications";

export type NotifTone = "primary" | "success" | "warning" | "info" | "neutral";

/** Libellé, icône et ton de chaque catégorie de notification (les mêmes que l'enum notification_category). */
export const categoryMeta: Record<NotifCategory, { label: string; icon: IconType; tone: NotifTone }> = {
  produit: { label: "Produits", icon: Tag, tone: "primary" },
  message: { label: "Messages", icon: MessageCircle, tone: "info" },
  achat: { label: "Achats et ventes", icon: ShoppingBag, tone: "success" },
  groupe: { label: "Groupes", icon: Users, tone: "primary" },
  evenement: { label: "Événements", icon: Ticket, tone: "warning" },
  formation: { label: "Formations", icon: GraduationCap, tone: "info" },
  systeme: { label: "Système", icon: Bell, tone: "neutral" },
  securite: { label: "Sécurité", icon: ShieldCheck, tone: "warning" },
};

/** Sépare « /profil?onglet=ventes » en chemin et paramètres de recherche, pour le routeur. */
export function splitTo(to: string): { to: string; search: Record<string, string> } {
  const [path = "/", query = ""] = to.split("?");
  return { to: path, search: Object.fromEntries(new URLSearchParams(query)) };
}
