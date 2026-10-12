import {
  Bell, BookOpen, CalendarDays, GraduationCap, Compass, Handshake, Headphones, Heart, Home, Laptop, MessageCircle,
  Package, Settings, ShoppingBag, Smartphone, Store, TShirt, Couch, Users, Zap, Ticket, Trophy, type IconType,
} from "@/components/icons";

/** Frais d'inscription (valeur de maquette — à brancher sur la config admin). */
export const REGISTRATION_FEE = 1000;

export { formatFcfa } from "./domain";

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

/* ---------- Catégories & produits ---------- */
export { categories, conditions, type CategorySlug, type Condition, type Stock, type Product } from "./domain";
import { type CategorySlug, type Condition, type Stock, type Product, type Seller, categoryOf } from "./domain";

/* Les annonces et vendeurs ci-dessous sont des données de démonstration pour les écrans qui ne sont pas
 * encore branchés sur la base. Ils sont adaptés au type réel (lib/domain.ts) pour que les composants partagés
 * n'aient qu'un seul type à connaître. Les écrans branchés lisent lib/api/products.ts. */
type LegacyProduct = {
  id: string;
  name: string;
  price: number;
  oldPrice?: number;
  campus: string;
  city: string;
  condition: Condition;
  sellerId: string;
  rating: number;
  reviews: number;
  posted: string;
  /** Ancienneté en jours (tri et filtre de fraîcheur). */
  postedDays: number;
  stock: Stock;
  icon: IconType;
  tone: string;
  category: CategorySlug;
  negotiable: boolean;
  quantity: number;
  description: string;
  specs: [label: string, value: string][];
  views: number;
  favorites: number;
};

const legacyProducts: LegacyProduct[] = [
  { id: "macbook-air-m2", name: "MacBook Air M2", price: 450000, oldPrice: 520000, campus: "UY1", city: "Yaoundé", condition: "Très bon état", sellerId: "jean-dupont", rating: 4.8, reviews: 23, posted: "il y a 2 h", postedDays: 0, stock: "available", icon: Laptop, tone: "from-cyan-400/30 to-blue-700/20", category: "ordinateurs", negotiable: true, quantity: 1, views: 412, favorites: 38,
    description: "MacBook Air M2 acheté neuf en 2024, utilisé pour mes études d'informatique. Aucune rayure, batterie à 94 %, vendu avec son chargeur d'origine et une housse de protection. Je le vends car je passe sur une machine plus puissante pour mon master.",
    specs: [["Marque", "Apple"], ["Processeur", "Apple M2"], ["Mémoire", "8 Go"], ["Stockage", "256 Go SSD"], ["Écran", "13,6 pouces"], ["Batterie", "94 % de santé"]] },
  { id: "iphone-13", name: "iPhone 13", price: 280000, campus: "UDB", city: "Douala", condition: "Bon état", sellerId: "aicha-mbarga", rating: 4.6, reviews: 12, posted: "il y a 5 h", postedDays: 0, stock: "low", icon: Smartphone, tone: "from-blue-400/30 to-sky-900/20", category: "telephones", negotiable: true, quantity: 2, views: 268, favorites: 21,
    description: "iPhone 13 débloqué tous opérateurs, écran protégé depuis l'achat, quelques micro-rayures sur le cadre. Livré avec câble et boîte. Deux exemplaires disponibles (128 Go).",
    specs: [["Marque", "Apple"], ["Stockage", "128 Go"], ["Couleur", "Minuit"], ["Batterie", "88 % de santé"], ["Débloqué", "Oui, tous opérateurs"]] },
  { id: "casque-jbl", name: "Casque JBL Tune 510BT", price: 25000, campus: "IUC", city: "Douala", condition: "Neuf", sellerId: "kevin-fotso", rating: 4.2, reviews: 4, posted: "hier", postedDays: 1, stock: "available", icon: Headphones, tone: "from-emerald-400/20 to-cyan-800/20", category: "audio", negotiable: false, quantity: 5, views: 143, favorites: 9,
    description: "Casque Bluetooth JBL neuf, dans son emballage d'origine. Jusqu'à 40 heures d'autonomie, idéal pour les révisions à la bibliothèque. Cinq exemplaires disponibles.",
    specs: [["Marque", "JBL"], ["Connexion", "Bluetooth 5.0"], ["Autonomie", "40 heures"], ["Couleur", "Noir"]] },
  { id: "hp-probook", name: "HP ProBook 450 G8", price: 195000, campus: "UDs", city: "Dschang", condition: "Occasion", sellerId: "marie-tchoua", rating: 4.4, reviews: 9, posted: "il y a 1 j", postedDays: 1, stock: "reserved", icon: Laptop, tone: "from-indigo-400/25 to-blue-900/20", category: "ordinateurs", negotiable: true, quantity: 1, views: 190, favorites: 12,
    description: "PC portable HP ProBook robuste, parfait pour la bureautique et la programmation. Clavier azerty en bon état, quelques traces d'usage sur la coque.",
    specs: [["Marque", "HP"], ["Processeur", "Intel Core i5"], ["Mémoire", "8 Go"], ["Stockage", "512 Go SSD"], ["Écran", "15,6 pouces"]] },
  { id: "pack-manuels-l1", name: "Pack manuels Licence 1", price: 18000, campus: "UY2", city: "Soa", condition: "Bon état", sellerId: "paul-ndzana", rating: 4.9, reviews: 31, posted: "il y a 3 j", postedDays: 3, stock: "available", icon: Package, tone: "from-sky-400/25 to-indigo-800/20", category: "livres", negotiable: true, quantity: 3, views: 320, favorites: 27,
    description: "Lot de 6 manuels (économie, droit, statistiques) utilisés en première année. Peu annotés, tous complets. Vendu en lot uniquement.",
    specs: [["Contenu", "6 manuels"], ["Filière", "Sciences économiques et gestion"], ["Niveau", "Licence 1"]] },
  { id: "samsung-a54", name: "Samsung Galaxy A54", price: 145000, campus: "UB", city: "Buea", condition: "Très bon état", sellerId: "grace-ekane", rating: 4.7, reviews: 17, posted: "il y a 4 j", postedDays: 4, stock: "sold", icon: Smartphone, tone: "from-teal-400/25 to-cyan-900/20", category: "telephones", negotiable: false, quantity: 0, views: 501, favorites: 44,
    description: "Samsung Galaxy A54 5G, très peu utilisé, vendu avec coque et film de protection.",
    specs: [["Marque", "Samsung"], ["Stockage", "128 Go"], ["Mémoire", "6 Go"], ["Couleur", "Graphite"]] },
  { id: "calculatrice", name: "Calculatrice Casio fx-991", price: 12000, campus: "ENSPY", city: "Yaoundé", condition: "Bon état", sellerId: "yannick-bell", rating: 4.5, reviews: 6, posted: "il y a 6 j", postedDays: 6, stock: "available", icon: Zap, tone: "from-cyan-300/25 to-blue-800/20", category: "livres", negotiable: true, quantity: 4, views: 98, favorites: 5,
    description: "Calculatrice scientifique autorisée aux examens de l'ENSPY. Fonctionne parfaitement, piles neuves.",
    specs: [["Marque", "Casio"], ["Modèle", "fx-991"], ["Autorisée en examen", "Oui"]] },
  { id: "cours-maths", name: "Cours particuliers de maths", price: 5000, campus: "UDo", city: "Douala", condition: "Neuf", sellerId: "ines-kamga", rating: 5, reviews: 42, posted: "il y a 1 sem", postedDays: 7, stock: "available", icon: GraduationCap, tone: "from-blue-300/25 to-violet-900/20", category: "services", negotiable: false, quantity: 10, views: 610, favorites: 63,
    description: "Cours particuliers de mathématiques (analyse, algèbre, probabilités) pour les étudiants de licence. Séances d'une heure sur le campus ou en visio. Prix par séance.",
    specs: [["Niveau", "Licence 1 à 3"], ["Durée", "1 heure par séance"], ["Lieu", "Campus ou visio"]] },
  { id: "tecno-camon", name: "Tecno Camon 20", price: 95000, campus: "UN", city: "Ngaoundéré", condition: "Bon état", sellerId: "aicha-mbarga", rating: 4.3, reviews: 5, posted: "il y a 2 j", postedDays: 2, stock: "available", icon: Smartphone, tone: "from-sky-300/25 to-blue-900/20", category: "telephones", negotiable: true, quantity: 1, views: 122, favorites: 8,
    description: "Tecno Camon 20, excellent appareil photo, batterie tient toute la journée. Vendu avec chargeur rapide.",
    specs: [["Marque", "Tecno"], ["Stockage", "256 Go"], ["Mémoire", "8 Go"]] },
  { id: "ecouteurs-sans-fil", name: "Écouteurs sans fil", price: 15000, campus: "IUT FV", city: "Bandjoun", condition: "Neuf", sellerId: "jean-dupont", rating: 4.4, reviews: 11, posted: "il y a 3 j", postedDays: 3, stock: "available", icon: Headphones, tone: "from-cyan-400/25 to-teal-900/20", category: "audio", negotiable: false, quantity: 12, views: 205, favorites: 16,
    description: "Écouteurs Bluetooth avec boîtier de charge, réduction de bruit basique, résistants à la transpiration.",
    specs: [["Connexion", "Bluetooth 5.2"], ["Autonomie", "6 h + 18 h avec le boîtier"]] },
  { id: "sac-a-dos", name: "Sac à dos étanche 25 L", price: 12000, campus: "UB", city: "Buea", condition: "Très bon état", sellerId: "grace-ekane", rating: 4.6, reviews: 8, posted: "il y a 5 j", postedDays: 5, stock: "available", icon: Package, tone: "from-blue-400/25 to-cyan-900/20", category: "mode", negotiable: true, quantity: 1, views: 77, favorites: 6,
    description: "Sac à dos étanche avec compartiment pour ordinateur 15 pouces. Porté une seule année.",
    specs: [["Capacité", "25 litres"], ["Compartiment PC", "15 pouces"]] },
  { id: "lampe-bureau", name: "Lampe de bureau LED", price: 8000, campus: "IUC", city: "Douala", condition: "Neuf", sellerId: "kevin-fotso", rating: 4.1, reviews: 3, posted: "il y a 1 sem", postedDays: 8, stock: "available", icon: Zap, tone: "from-amber-300/20 to-blue-900/20", category: "maison", negotiable: false, quantity: 6, views: 64, favorites: 4,
    description: "Lampe de bureau LED à intensité réglable, port USB de charge. Parfaite pour les chambres universitaires.",
    specs: [["Puissance", "9 W"], ["Réglages", "3 niveaux de luminosité"]] },
  { id: "dell-latitude", name: "Dell Latitude 5490", price: 160000, campus: "UDo", city: "Douala", condition: "Occasion", sellerId: "yannick-bell", rating: 4.0, reviews: 2, posted: "il y a 32 j", postedDays: 32, stock: "expired", icon: Laptop, tone: "from-slate-400/25 to-blue-900/20", category: "ordinateurs", negotiable: true, quantity: 1, views: 173, favorites: 7,
    description: "PC portable professionnel Dell Latitude, robuste, batterie remplacée récemment. Annonce arrivée à échéance.",
    specs: [["Marque", "Dell"], ["Processeur", "Intel Core i5"], ["Mémoire", "8 Go"], ["Stockage", "256 Go SSD"]] },
];

export function getProduct(id: string) {
  return products.find((p) => p.id === id);
}

/* ---------- Vendeurs ---------- */
export type { Seller } from "./domain";

const legacySellers: Omit<Seller, "reviews" | "avatarUrl">[] = [
  { id: "jean-dupont", name: "Jean Dupont", campus: "IUT FV · Bandjoun", listings: 14, sales: 38, rating: 4.8, verified: true, since: "Membre depuis 2025", bio: "Étudiant en informatique. Je revends mon matériel en bon état et réponds vite aux messages." },
  { id: "aicha-mbarga", name: "Aïcha Mbarga", campus: "UDB · Douala", listings: 8, sales: 21, rating: 4.6, verified: true, since: "Membre depuis 2025", bio: "Téléphones reconditionnés et accessoires. Remise en main propre sur le campus." },
  { id: "kevin-fotso", name: "Kevin Fotso", campus: "IUC · Douala", listings: 3, sales: 4, rating: 4.2, verified: false, since: "Membre depuis 2026", bio: "Accessoires audio et articles pour chambre étudiante." },
  { id: "marie-tchoua", name: "Marie Tchoua", campus: "UDs · Dschang", listings: 5, sales: 12, rating: 4.4, verified: true, since: "Membre depuis 2025" },
  { id: "paul-ndzana", name: "Paul Ndzana", campus: "UY2 · Soa", listings: 9, sales: 27, rating: 4.9, verified: false, since: "Membre depuis 2025", bio: "Livres et manuels de sciences économiques et de droit." },
  { id: "grace-ekane", name: "Grace Ekane", campus: "UB · Buea", listings: 6, sales: 17, rating: 4.7, verified: true, since: "Membre depuis 2025" },
  { id: "yannick-bell", name: "Yannick Bell", campus: "ENSPY · Yaoundé", listings: 4, sales: 6, rating: 4.5, verified: true, since: "Membre depuis 2026" },
  { id: "ines-kamga", name: "Inès Kamga", campus: "UDo · Douala", listings: 2, sales: 42, rating: 5, verified: true, since: "Membre depuis 2025", bio: "Étudiante en master de mathématiques, répétitrice depuis trois ans." },
];

export const sellers: Seller[] = legacySellers.map((x) => ({ ...x, reviews: 0, avatarUrl: null }));

export const products: Product[] = legacyProducts.map((p) => {
  const seller = sellers.find((x) => x.id === p.sellerId);
  const { sellerId, icon, tone, ...rest } = p;
  const category = categoryOf(p.category);
  return {
    ...rest,
    sellerId,
    icon: icon ?? category.icon,
    tone: tone ?? category.tone,
    status: "published" as const,
    sellerName: seller?.name ?? "Vendeur",
    sellerCampus: seller?.campus ?? "",
    sellerVerified: seller?.verified ?? false,
    sellerAvatarUrl: null,
    images: [],
  };
});


export function getSeller(id: string): Seller | undefined {
  return sellers.find((s) => s.id === id);
}

export const sellerReviews = [
  { id: "r1", author: "Aïcha M.", rating: 5, date: "il y a 2 sem", text: "Vendeur sérieux, l'article était conforme à l'annonce. Remise en main propre rapide." },
  { id: "r2", author: "Kevin F.", rating: 4, date: "il y a 1 mois", text: "Bonne communication. Petit retard sur le rendez-vous mais tout s'est bien passé." },
  { id: "r3", author: "Marie T.", rating: 5, date: "il y a 2 mois", text: "Je recommande, prix juste et article en excellent état." },
];

/* ---------- Demandes « Je recherche » ---------- */
export type WantedRequest = { id: string; title: string; description: string; budget: number; category: CategorySlug; campus: string; author: string; posted: string; responses: number; status: "ouverte" | "pourvue" };

export const wantedRequests: WantedRequest[] = [
  { id: "w1", title: "Ordinateur portable pour la programmation", description: "Je cherche un PC avec 8 Go de RAM minimum et un SSD, pour mes cours de développement web.", budget: 250000, category: "ordinateurs", campus: "UY1 · Yaoundé", author: "Ruth Nkeng", posted: "il y a 3 h", responses: 4, status: "ouverte" },
  { id: "w2", title: "Manuels de droit civil L2", description: "Recherche les manuels du programme de deuxième année, même annotés.", budget: 20000, category: "livres", campus: "UDo · Douala", author: "Patrick Essomba", posted: "il y a 1 j", responses: 2, status: "ouverte" },
  { id: "w3", title: "Smartphone Android avec bon appareil photo", description: "Pour mon projet de photographie. Budget flexible pour un appareil en bon état.", budget: 300000, category: "telephones", campus: "UB · Buea", author: "Sandra Fon", posted: "il y a 2 j", responses: 7, status: "ouverte" },
  { id: "w4", title: "Casque audio pour la bibliothèque", description: "Casque fermé, de préférence avec réduction de bruit.", budget: 30000, category: "audio", campus: "UDs · Dschang", author: "Brice Tagne", posted: "il y a 4 j", responses: 3, status: "pourvue" },
  { id: "w5", title: "Cours de soutien en statistiques", description: "Deux séances par semaine, niveau licence 2, sur le campus.", budget: 10000, category: "services", campus: "UY2 · Soa", author: "Mireille Abena", posted: "il y a 5 j", responses: 5, status: "ouverte" },
];

/* ---------- Pays & universités (onboarding) ---------- */
export type Country = { code: string; name: string; dial: string; mobileMoney: string[] };

export const countries: Country[] = [
  { code: "CM", name: "Cameroun", dial: "+237", mobileMoney: ["MTN MoMo", "Orange Money"] },
  { code: "CI", name: "Côte d'Ivoire", dial: "+225", mobileMoney: ["MTN MoMo", "Orange Money", "Wave"] },
  { code: "SN", name: "Sénégal", dial: "+221", mobileMoney: ["Orange Money", "Wave"] },
  { code: "GA", name: "Gabon", dial: "+241", mobileMoney: ["Airtel Money"] },
  { code: "CD", name: "RD Congo", dial: "+243", mobileMoney: ["Airtel Money", "Orange Money"] },
  { code: "BJ", name: "Bénin", dial: "+229", mobileMoney: ["MTN MoMo", "Moov Money"] },
  { code: "TG", name: "Togo", dial: "+228", mobileMoney: ["Moov Money"] },
  { code: "BF", name: "Burkina Faso", dial: "+226", mobileMoney: ["Orange Money", "Moov Money"] },
  { code: "ML", name: "Mali", dial: "+223", mobileMoney: ["Orange Money", "Moov Money"] },
  { code: "GN", name: "Guinée", dial: "+224", mobileMoney: ["Orange Money", "MTN MoMo"] },
  { code: "CG", name: "Congo", dial: "+242", mobileMoney: ["MTN MoMo", "Airtel Money"] },
  { code: "MA", name: "Maroc", dial: "+212", mobileMoney: ["Carte bancaire"] },
];

export type University = { id: string; name: string; short: string; city: string; country: string; students: string };

export const universities: University[] = [
  { id: "uy1", name: "Université de Yaoundé I", short: "UY1", city: "Yaoundé", country: "CM", students: "45 000 étudiants" },
  { id: "uy2", name: "Université de Yaoundé II", short: "UY2", city: "Soa", country: "CM", students: "38 000 étudiants" },
  { id: "udo", name: "Université de Douala", short: "UDo", city: "Douala", country: "CM", students: "52 000 étudiants" },
  { id: "uds", name: "Université de Dschang", short: "UDs", city: "Dschang", country: "CM", students: "24 000 étudiants" },
  { id: "ub", name: "Université de Buea", short: "UB", city: "Buea", country: "CM", students: "19 000 étudiants" },
  { id: "un", name: "Université de Ngaoundéré", short: "UN", city: "Ngaoundéré", country: "CM", students: "21 000 étudiants" },
  { id: "iutfv", name: "IUT Fotso Victor de Bandjoun", short: "IUT FV", city: "Bandjoun", country: "CM", students: "4 200 étudiants" },
  { id: "enspy", name: "École Nationale Supérieure Polytechnique", short: "ENSPY", city: "Yaoundé", country: "CM", students: "3 100 étudiants" },
  { id: "ucac", name: "Université Catholique d'Afrique Centrale", short: "UCAC", city: "Yaoundé", country: "CM", students: "6 000 étudiants" },
  { id: "iuc", name: "Institut Universitaire de la Côte", short: "IUC", city: "Douala", country: "CM", students: "7 500 étudiants" },
  { id: "ucad", name: "Université Cheikh Anta Diop", short: "UCAD", city: "Dakar", country: "SN", students: "80 000 étudiants" },
  { id: "ufhb", name: "Université Félix Houphouët-Boigny", short: "UFHB", city: "Abidjan", country: "CI", students: "60 000 étudiants" },
  { id: "uob", name: "Université Omar Bongo", short: "UOB", city: "Libreville", country: "GA", students: "18 000 étudiants" },
  { id: "uac", name: "Université d'Abomey-Calavi", short: "UAC", city: "Abomey-Calavi", country: "BJ", students: "55 000 étudiants" },
];

export const currentUser = { name: "Jean Dupont", initials: "JD", campus: "IUT FV", filiere: "Informatique", verified: true };

/* ---------- Mobile Money ---------- */
export { paymentMethods } from "./domain";

