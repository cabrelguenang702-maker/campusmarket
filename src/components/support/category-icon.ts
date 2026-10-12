import { Coin, HelpCircle, Shield, Store, Ticket, User, type IconType } from "@/components/icons";

/** Icône d'une catégorie d'aide d'après son identifiant (les catégories viennent de la base ; une nouvelle catégorie reçoit l'icône générique). */
const ICONS: Record<string, IconType> = { compte: User, paiements: Coin, billetterie: Ticket, marketplace: Store, securite: Shield };

export const categoryIcon = (slug: string): IconType => ICONS[slug] ?? HelpCircle;
