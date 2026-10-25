/* Informations juridiques de CampusMarket, utilisées par les pages /conditions, /confidentialite et /mentions-legales.
 *
 * AVANT L'OUVERTURE AU PUBLIC :
 *  1. Remplacez chaque valeur entre crochets [...] ci-dessous par la vraie information (elles s'affichent en surbrillance
 *     jaune sur les pages tant qu'elles restent entre crochets).
 *  2. Faites relire les trois textes par un juriste (droit applicable, protection des données, droit de la consommation,
 *     règles du paiement mobile dans chaque pays où vous ouvrez le service).
 *  3. Passez `reviewed` à true : le bandeau « brouillon » disparaît.
 */
export const LEGAL = {
  /** true uniquement après relecture par un juriste. Tant que c'est false, un bandeau « brouillon » s'affiche en haut des pages légales. */
  reviewed: false,
  lastUpdate: "22 octobre 2026",
  site: "campusmarket.me",
  siteUrl: "https://campusmarket.me",
  /** Éditeur du service. */
  publisher: {
    name: "[NOM DE LA SOCIÉTÉ OU DE L'ÉDITEUR]",
    legalForm: "[FORME JURIDIQUE, ex. SARL, association, entreprise individuelle]",
    capital: "[CAPITAL SOCIAL, si société]",
    address: "[ADRESSE DU SIÈGE]",
    registration: "[NUMÉRO D'IMMATRICULATION (RCCM ou équivalent)]",
    taxId: "[NUMÉRO D'IDENTIFIANT FISCAL, si applicable]",
    director: "[NOM DU DIRECTEUR DE LA PUBLICATION]",
    email: "[ADRESSE E-MAIL DE CONTACT]",
    phone: "[TÉLÉPHONE DE CONTACT]",
  },
  /** Contact pour les demandes sur les données personnelles. */
  privacyContact: "[ADRESSE E-MAIL POUR LES DONNÉES PERSONNELLES]",
  /** Hébergeur du site web. */
  siteHost: "[HÉBERGEUR DU SITE : nom, adresse. À confirmer, probablement Vercel Inc.]",
  /** Pays dont le droit s'applique et tribunaux compétents. */
  governingLaw: "[PAYS DONT LE DROIT S'APPLIQUE]",
  jurisdiction: "[JURIDICTION COMPÉTENTE]",
  minAge: "[ÂGE MINIMUM, à fixer avec le juriste]",
} as const;
