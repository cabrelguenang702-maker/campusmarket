import { createFileRoute } from "@tanstack/react-router";
import { AppLink } from "@/components/cm/app-link";
import { Fill, LegalDoc, type LegalSection } from "@/components/legal/LegalDoc";
import { LEGAL } from "@/lib/legal";

export const Route = createFileRoute("/_legal/confidentialite")({
  head: () => ({ meta: [{ title: "Politique de confidentialité — CampusMarket" }, { name: "description", content: "Quelles données CampusMarket collecte, pourquoi, avec qui elles sont partagées et comment exercer vos droits." }] }),
  component: PrivacyPage,
});

const sections: LegalSection[] = [
  {
    title: "Qui est responsable de vos données",
    body: (
      <p>Le responsable du traitement est <Fill>{LEGAL.publisher.name}</Fill>, <Fill>{LEGAL.publisher.address}</Fill>. Pour toute question sur vos données : <Fill>{LEGAL.privacyContact}</Fill>.</p>
    ),
  },
  {
    title: "Les données que nous collectons",
    body: (
      <ul>
        <li><strong>Compte et profil</strong> : nom, adresse e-mail, mot de passe (stocké sous forme chiffrée, que nous ne pouvons pas lire), pays, université, numéro de téléphone (vérifié par un code), photo et informations que vous ajoutez à votre profil.</li>
        <li><strong>Contenus</strong> : annonces, photos, avis, messages échangés avec d'autres utilisateurs, publications, inscriptions aux formations, groupes et événements, résultats de quiz, notifications.</li>
        <li><strong>Transactions</strong> : commandes, montants, frais et commissions, références de paiement, opérateur et numéro Mobile Money utilisés pour payer ; pour les créateurs, le compte Mobile Money de versement (opérateur, numéro, nom du titulaire) et l'historique des gains et versements.</li>
        <li><strong>Sécurité et usage</strong> : appareils et navigateurs connus de votre compte, journaux techniques (adresse IP, date et heure, erreurs), tentatives de connexion, actions d'administration, signalements.</li>
        <li><strong>Assistant d'étude</strong> : le texte que vous envoyez à l'assistant et, si vous l'indiquez, le titre et le plan du cours concerné. Cette conversation n'est pas enregistrée sur nos serveurs après la réponse.</li>
        <li><strong>Notifications push</strong> (si vous les activez) : un identifiant de l'appareil ou du navigateur nécessaire pour vous envoyer les alertes.</li>
      </ul>
    ),
  },
  {
    title: "Pourquoi nous les utilisons",
    body: (
      <ul>
        <li><strong>Fournir le service</strong> (exécution du contrat) : créer et sécuriser votre compte, publier des annonces, traiter les commandes et les paiements, verser les gains, mettre en relation les utilisateurs, donner accès aux formations.</li>
        <li><strong>Sécurité et lutte contre la fraude</strong> (intérêt légitime) : vérifier les identités, détecter les connexions inhabituelles, modérer les contenus, prévenir les abus.</li>
        <li><strong>Communications</strong> : codes de vérification, notifications du service, e-mails de sécurité et, selon vos réglages, notifications push et e-mails. Vous pouvez régler les notifications dans Profil, puis Paramètres ; les alertes de sécurité restent toujours actives.</li>
        <li><strong>Obligations légales</strong> : conservation de pièces comptables, réponse aux autorités compétentes.</li>
        <li><strong>Amélioration du service</strong> : statistiques agrégées sur l'usage, sans publicité ciblée.</li>
      </ul>
    ),
  },
  {
    title: "Avec qui nous les partageons",
    body: (
      <>
        <p>Nous ne vendons pas vos données. Nous les partageons uniquement avec :</p>
        <ul>
          <li><strong>Les autres utilisateurs</strong>, pour ce que vous rendez public ou nécessaire à une transaction (votre nom et votre profil public, vos annonces, vos messages à votre interlocuteur).</li>
          <li><strong>Nos prestataires techniques</strong>, qui agissent pour notre compte : Supabase (base de données, authentification et fonctions serveur) ; <Fill>{LEGAL.siteHost}</Fill> (hébergement du site) ; CamPay (paiements Mobile Money) ; <Fill>[PRESTATAIRE D'E-MAIL, ex. Brevo]</Fill> (envoi d'e-mails) ; <Fill>[PRESTATAIRE DE SMS OU WHATSAPP]</Fill> (codes de vérification) ; Google (service d'intelligence artificielle de l'assistant d'étude, qui reçoit le texte que vous lui envoyez) ; <Fill>[ONESIGNAL, si les notifications push sont activées]</Fill>.</li>
          <li><strong>Les autorités</strong>, quand la loi nous y oblige.</li>
        </ul>
      </>
    ),
  },
  {
    title: "Où sont stockées vos données",
    body: (
      <p>La base de données de la plateforme est hébergée par Supabase dans la région « UE (Irlande) ». Certains prestataires (hébergement du site, e-mail, paiement, intelligence artificielle) peuvent traiter des données dans d'autres pays, y compris hors d'Afrique. Nous choisissons des prestataires qui appliquent des garanties de sécurité et de confidentialité. <Fill>[À VALIDER PAR UN JURISTE : cadre légal des transferts de données hors du pays de l'utilisateur, selon les pays ouverts]</Fill></p>
    ),
  },
  {
    title: "Combien de temps nous les gardons",
    body: (
      <>
        <p>Nous conservons vos données tant que votre compte est actif, puis pendant la durée nécessaire aux finalités ci-dessus. <Fill>[À COMPLÉTER : durées précises, par exemple compte et contenus après suppression, journaux techniques, pièces comptables et données de paiement]</Fill></p>
        <p>Si vous désactivez votre compte, votre profil et vos annonces sont masqués mais conservés ; vous pouvez revenir à tout moment.</p>
      </>
    ),
  },
  {
    title: "Vos droits",
    body: (
      <>
        <ul>
          <li><strong>Accès et copie</strong> : « Télécharger mes données » (Profil, Paramètres, Mes données) fournit un fichier avec vos informations. Limité à 3 exports par heure.</li>
          <li><strong>Rectification</strong> : vous modifiez votre profil depuis l'application.</li>
          <li><strong>Désactivation</strong> : réversible, depuis les paramètres.</li>
          <li><strong>Suppression définitive</strong> : sur demande à notre équipe (centre d'aide ou <Fill>{LEGAL.privacyContact}</Fill>). Certaines données peuvent être conservées si la loi l'exige (par exemple les transactions).</li>
          <li><strong>Opposition et retrait du consentement</strong> : par exemple pour les notifications, dans les paramètres.</li>
        </ul>
        <p>Nous répondons dans un délai raisonnable <Fill>[À COMPLÉTER : délai]</Fill>. Vous pouvez aussi saisir l'autorité de protection des données de votre pays. <Fill>[À VÉRIFIER PAR UN JURISTE : loi applicable et autorité compétente dans chaque pays, par exemple au Cameroun la loi n° 2024/017 du 23 décembre 2024 relative à la protection des données à caractère personnel]</Fill></p>
      </>
    ),
  },
  {
    title: "Sécurité",
    body: (
      <p>Nous protégeons vos données par des moyens techniques : connexion chiffrée (HTTPS), mots de passe chiffrés, règles d'accès strictes au niveau de la base de données, double authentification pour l'équipe, journalisation des actions sensibles. Aucun système n'est infaillible : gardez votre mot de passe secret et prévenez-nous en cas de doute. En cas d'incident grave touchant vos données, nous vous informons et informons l'autorité compétente lorsque la loi l'exige.</p>
    ),
  },
  {
    title: "Cookies et stockage dans votre navigateur",
    body: (
      <p>L'application utilise le stockage de votre navigateur pour fonctionner : session de connexion, préférences (thème clair ou sombre), avancement de l'inscription. À notre connaissance, aucun traceur publicitaire ni outil de mesure d'audience tiers n'est utilisé au moment de la rédaction. <Fill>[À VÉRIFIER avant publication et à mettre à jour si un outil est ajouté]</Fill></p>
    ),
  },
  {
    title: "Mineurs",
    body: (
      <p>La plateforme est réservée aux personnes ayant au moins <Fill>{LEGAL.minAge}</Fill>. Si vous pensez qu'un mineur a créé un compte sans y être autorisé, contactez-nous : nous supprimerons le compte.</p>
    ),
  },
  {
    title: "Modifications et contact",
    body: (
      <>
        <p>Nous pouvons mettre à jour cette politique ; la date en haut de page indique la dernière version, et nous vous informons des changements importants.</p>
        <p>Contact : <Fill>{LEGAL.privacyContact}</Fill>. Voir aussi les <AppLink to="/conditions" className="font-semibold text-primary hover:underline">conditions d'utilisation</AppLink> et les <AppLink to="/mentions-legales" className="font-semibold text-primary hover:underline">mentions légales</AppLink>.</p>
      </>
    ),
  },
];

function PrivacyPage() {
  return <LegalDoc title="Politique de confidentialité" intro={<p>Cette page explique, simplement, quelles données personnelles CampusMarket utilise, pourquoi, avec qui nous les partageons et comment vous gardez le contrôle.</p>} sections={sections} />;
}
