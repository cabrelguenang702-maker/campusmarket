import { createFileRoute } from "@tanstack/react-router";
import { AppLink } from "@/components/cm/app-link";
import { Fill, LegalDoc, type LegalSection } from "@/components/legal/LegalDoc";
import { LEGAL } from "@/lib/legal";

export const Route = createFileRoute("/_legal/conditions")({
  head: () => ({ meta: [{ title: "Conditions d'utilisation — CampusMarket" }, { name: "description", content: "Les règles d'utilisation de CampusMarket : compte, annonces, paiements, formations, communauté." }] }),
  component: TermsPage,
});

const sections: LegalSection[] = [
  {
    title: "Objet et acceptation",
    body: (
      <>
        <p>CampusMarket (« la plateforme ») est un service en ligne, accessible sur {LEGAL.site}, qui permet aux étudiants d'acheter et de vendre des articles et des services, de suivre des formations, de rejoindre des groupes d'étude et des communautés, de participer à des événements et d'échanger entre eux. Il est édité par <Fill>{LEGAL.publisher.name}</Fill> (« CampusMarket », « nous »).</p>
        <p>Les présentes conditions encadrent l'utilisation de la plateforme. En créant un compte ou en l'utilisant, vous déclarez les avoir lues et vous les acceptez. Si vous n'êtes pas d'accord, n'utilisez pas la plateforme.</p>
      </>
    ),
  },
  {
    title: "Compte et accès",
    body: (
      <>
        <ul>
          <li>Pour utiliser la plateforme, il faut avoir au moins <Fill>{LEGAL.minAge}</Fill> et être capable de s'engager.</li>
          <li>Vous fournissez des informations exactes (nom, adresse e-mail, numéro de téléphone, université) et les tenez à jour. Votre adresse e-mail et votre numéro de téléphone sont vérifiés par un code.</li>
          <li>Un seul compte par personne. Vous êtes responsable de la confidentialité de votre mot de passe et de toute activité faite depuis votre compte. En cas de perte ou de suspicion de piratage, changez votre mot de passe et prévenez-nous sans délai.</li>
          <li>Selon votre pays, des frais d'inscription uniques peuvent être demandés. Le montant est affiché avant tout paiement.</li>
        </ul>
      </>
    ),
  },
  {
    title: "Rôle de CampusMarket",
    body: (
      <>
        <p>CampusMarket met en relation des utilisateurs. Sauf indication contraire affichée sur l'annonce, la vente d'un article ou d'un service est conclue <strong>entre l'acheteur et le vendeur</strong> : CampusMarket n'est ni vendeur ni acheteur, et ne garantit pas la qualité, la conformité ou la légalité des articles et services proposés par les utilisateurs. <Fill>[À VALIDER PAR UN JURISTE : étendue exacte de la responsabilité de la plateforme en tant qu'intermédiaire]</Fill></p>
        <p>Nous fournissons des outils pour sécuriser les échanges : paiement via la plateforme, messagerie, avis, signalement, modération.</p>
      </>
    ),
  },
  {
    title: "Annonces, formations et contenus publiés",
    body: (
      <>
        <p>Vous restez propriétaire de ce que vous publiez (annonces, photos, avis, messages, cours, publications). Vous nous accordez le droit, gratuit et non exclusif, de l'héberger, de l'afficher et de le diffuser sur la plateforme pour fournir le service.</p>
        <p>Vous garantissez que vous avez le droit de publier ces contenus et qu'ils sont exacts. Une annonce doit décrire honnêtement l'article ou le service, son prix et son état.</p>
        <p><strong>Sont interdits</strong> notamment : les produits ou services illégaux, contrefaits, dangereux ou volés ; les armes, drogues et médicaments sans autorisation ; les contenus à caractère sexuel, haineux, violent, discriminatoire ou de harcèlement ; les fausses annonces, arnaques et tentatives d'hameçonnage ; la vente de devoirs, travaux ou diplômes destinés à tromper une institution ; l'usurpation d'identité ; la collecte de données d'autres utilisateurs ; toute tentative de contourner la sécurité ou les paiements de la plateforme.</p>
      </>
    ),
  },
  {
    title: "Commandes et paiements",
    body: (
      <>
        <ul>
          <li>Les paiements se font par Mobile Money (MTN Mobile Money, Orange Money) via notre prestataire de paiement. Le prix, les frais de service et le total sont affichés avant la confirmation. Vous confirmez le paiement sur votre téléphone.</li>
          <li>Pour une commande, le paiement est encaissé par CampusMarket puis reversé au vendeur après la clôture de la commande et un délai de sécurité. <Fill>[À VALIDER : délai et conditions exacts de reversement]</Fill></li>
          <li>Des commissions ou frais peuvent s'appliquer aux vendeurs, créateurs de formations, organisateurs d'événements et tuteurs. Elles sont affichées avant que vous ne vous engagiez et peuvent évoluer ; la nouvelle valeur ne s'applique qu'aux opérations futures.</li>
          <li>Les créateurs reçoivent leurs gains sur le compte Mobile Money qu'ils ont renseigné ; ils en sont responsables (numéro et titulaire exacts). Les versements sont effectués par notre équipe et indiqués dans « Mes gains ».</li>
          <li>Remboursements et litiges : si une commande ne se passe pas comme prévu, contactez le vendeur puis notre support depuis le centre d'aide. <Fill>[À COMPLÉTER : règles de litige, de remboursement et délais, et droits des consommateurs applicables dans chaque pays]</Fill></li>
          <li>En cas de paiement frauduleux ou de suspicion d'abus, nous pouvons retenir ou annuler une opération et suspendre un compte.</li>
        </ul>
      </>
    ),
  },
  {
    title: "Formations, tutorat, groupes et événements",
    body: (
      <>
        <p>Les formations, séances de tutorat, groupes d'étude et événements sont proposés par des utilisateurs, qui sont responsables de leur contenu et de leur déroulement. Un achat de formation donne un accès personnel, non cessible, pour un usage privé ; il est interdit de copier, revendre ou redistribuer le contenu sans l'accord de l'auteur.</p>
        <p>CampusMarket n'est pas un établissement d'enseignement : les formations, quiz et attestations de la plateforme ne remplacent pas un diplôme officiel.</p>
      </>
    ),
  },
  {
    title: "Assistant d'étude (intelligence artificielle)",
    body: (
      <>
        <p>La plateforme propose un assistant qui explique, résume ou fait réviser. Les réponses sont produites automatiquement et <strong>peuvent contenir des erreurs</strong> : vérifiez-les avec votre cours. L'assistant est un outil d'aide à l'apprentissage ; vous restez responsable de vos travaux et du respect des règles de votre établissement. Le texte que vous lui envoyez est traité par un prestataire (voir la politique de confidentialité). N'y saisissez pas d'informations sensibles.</p>
        <p>Des limites d'usage quotidiennes s'appliquent.</p>
      </>
    ),
  },
  {
    title: "Comportement, signalement et modération",
    body: (
      <>
        <p>Respectez les autres utilisateurs. Vous pouvez signaler une annonce, un message ou un profil depuis la plateforme. Notre équipe peut retirer un contenu, masquer ou suspendre un compte, ou en limiter l'accès, notamment en cas de non-respect des présentes conditions, de fraude, de signalements répétés ou d'obligation légale. Nous informons l'utilisateur concerné quand c'est possible, et il peut nous contacter pour contester une décision.</p>
      </>
    ),
  },
  {
    title: "Abonnements et services optionnels",
    body: (
      <p>Certains services sont payants : par exemple la Boutique Premium (badge, absence de commission vendeur pendant la période) et les annonces sponsorisées. La durée, le prix et les avantages sont indiqués avant le paiement. Les périodes d'abonnement successives s'enchaînent. <Fill>[À COMPLÉTER : conditions de renouvellement, d'annulation et de remboursement]</Fill></p>
    ),
  },
  {
    title: "Disponibilité du service",
    body: (
      <p>Nous faisons de notre mieux pour que la plateforme soit disponible, mais nous ne pouvons pas garantir un service sans interruption ni sans erreur (maintenance, panne, réseau mobile, incident chez un prestataire). Nous pouvons faire évoluer, suspendre ou arrêter une fonctionnalité.</p>
    ),
  },
  {
    title: "Responsabilité",
    body: (
      <p>Dans les limites permises par la loi, CampusMarket n'est pas responsable des dommages indirects, de la perte de données ou d'opportunités, ni du comportement et des contenus des utilisateurs. Cette clause ne limite pas les droits dont vous disposez impérativement en tant que consommateur. <Fill>[À ADAPTER PAR UN JURISTE selon le droit applicable]</Fill></p>
    ),
  },
  {
    title: "Données personnelles",
    body: (
      <p>Le traitement de vos données personnelles est décrit dans notre <AppLink to="/confidentialite" className="font-semibold text-primary hover:underline">politique de confidentialité</AppLink>.</p>
    ),
  },
  {
    title: "Fermeture du compte",
    body: (
      <>
        <p>Vous pouvez désactiver votre compte à tout moment depuis Profil, puis Paramètres (réversible) ou demander sa suppression définitive à notre équipe depuis le centre d'aide. Nous pouvons suspendre ou fermer un compte qui ne respecte pas ces conditions. Les opérations en cours (commandes, versements) restent dues, et certaines données sont conservées lorsque la loi l'exige.</p>
      </>
    ),
  },
  {
    title: "Modification des conditions",
    body: (
      <p>Nous pouvons modifier ces conditions, par exemple pour tenir compte d'une évolution du service ou de la loi. En cas de changement important, nous vous en informons dans l'application ou par e-mail. Continuer à utiliser la plateforme après la date d'entrée en vigueur vaut acceptation.</p>
    ),
  },
  {
    title: "Droit applicable et contact",
    body: (
      <>
        <p>Les présentes conditions sont soumises au droit de <Fill>{LEGAL.governingLaw}</Fill>. En cas de litige, nous vous invitons d'abord à nous contacter pour trouver une solution amiable ; à défaut, les tribunaux de <Fill>{LEGAL.jurisdiction}</Fill> sont compétents, sous réserve des règles protectrices applicables aux consommateurs.</p>
        <p>Contact : <Fill>{LEGAL.publisher.email}</Fill> ou le <AppLink to="/aide" className="font-semibold text-primary hover:underline">centre d'aide</AppLink>. Voir aussi les <AppLink to="/mentions-legales" className="font-semibold text-primary hover:underline">mentions légales</AppLink>.</p>
      </>
    ),
  },
];

function TermsPage() {
  return <LegalDoc title="Conditions d'utilisation" intro={<p>Merci d'utiliser CampusMarket. Ces conditions expliquent les règles de la plateforme, vos droits et vos obligations. Lisez-les attentivement.</p>} sections={sections} />;
}
