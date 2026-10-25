import {
  Bell, BookOpen, CalendarDays, GraduationCap, Compass, Handshake, Heart, Home, MessageCircle,
  Settings, Store, Users, type IconType,
} from "@/components/icons";

/** Navigation principale et secondaire de l'application (sidebar, menu mobile). */
/* ---------- Navigation ---------- */
export type NavItem = { label: string; to: string; icon: IconType; badge?: number };

export const mainNav: NavItem[] = [
  { label: "Accueil", to: "/", icon: Home },
  { label: "Explorer", to: "/marketplace", icon: Compass },
  { label: "Marketplace", to: "/marketplace", icon: Store },
  { label: "Formations", to: "/formations", icon: GraduationCap },
  { label: "Communautés", to: "/communautes", icon: Users },
  { label: "Groupes", to: "/groupes", icon: Handshake },
  { label: "Événements", to: "/evenements", icon: CalendarDays },
  { label: "Universités", to: "/universites", icon: BookOpen },
];

export const secondaryNav: NavItem[] = [
  { label: "Favoris", to: "/favoris", icon: Heart },
  { label: "Messages", to: "/messages", icon: MessageCircle },
  { label: "Notifications", to: "/notifications", icon: Bell },
  { label: "Paramètres", to: "/profil/parametres", icon: Settings },
];
