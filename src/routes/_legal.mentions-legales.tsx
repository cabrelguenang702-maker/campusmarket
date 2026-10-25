import { createFileRoute } from "@tanstack/react-router";
import { AppLink } from "@/components/cm/app-link";
import { Fill, LegalDoc, type LegalSection } from "@/components/legal/LegalDoc";
import { LEGAL } from "@/lib/legal";

export const Route = createFileRoute("/_legal/mentions-legales")({
  head: () => ({ meta: [{ title: "Mentions légales — CampusMarket" }, { name: "description", content: "Éditeur, hébergeurs et informations légales du site CampusMarket." }] }),
  component: LegalNoticePage,
});

const p = LEGAL.publisher;

const sections: LegalSection[] = [
  {
    title: "Éditeur du site",
    body: (
      <ul>
        <li>Nom : <Fill>{p.name}</Fill></li>
        <li>Forme juridique : <Fill>{p.legalForm}</Fill></li>
        <li>Capital social : <Fill>{p.capital}</Fill></li>
        <li>Siège : <Fill>{p.address}</Fill></li>
        <li>Immatriculation : <Fill>{p.registration}</Fill></li>
        <li>Identifiant fiscal : <Fill>{p.taxId}</Fill></li>
        <li>Directeur de la publication : <Fill>{p.director}</Fill></li>
        <li>E-mail : <Fill>{p.email}</Fill> · Téléphone : <Fill>{p.phone}</Fill></li>
      </ul>
    ),
  },
  {
    title: "Hébergement",
    body: (
      <ul>
        <li>Site web ({LEGAL.site}) : <Fill>{LEGAL.siteHost}</Fill></li>
        <li>Base de données, authentification et fonctions serveur : Supabase, région « UE (Irlande) ». <Fill>[ADRESSE DE L'HÉBERGEUR, à compléter]</Fill></li>
      </ul>
    ),
  },
  {
    title: "Propriété intellectuelle",
    body: (
      <p>La marque, le logo, le design, les textes et le code de la plateforme appartiennent à l'éditeur ou à ses concédants et sont protégés par le droit de la propriété intellectuelle. Toute reproduction ou réutilisation sans autorisation écrite est interdite. Les contenus publiés par les utilisateurs restent leur propriété, comme expliqué dans les <AppLink to="/conditions" className="font-semibold text-primary hover:underline">conditions d'utilisation</AppLink>.</p>
    ),
  },
  {
    title: "Signaler un contenu illicite",
    body: (
      <p>Pour signaler une annonce, un message ou un profil, utilisez le bouton de signalement de la plateforme. Pour une demande plus détaillée (contenu illicite, atteinte à vos droits), écrivez à <Fill>{p.email}</Fill> en indiquant le lien du contenu et le motif. Nous examinons chaque signalement et retirons ce qui doit l'être.</p>
    ),
  },
  {
    title: "Données personnelles",
    body: (
      <p>Voir la <AppLink to="/confidentialite" className="font-semibold text-primary hover:underline">politique de confidentialité</AppLink>. Contact pour exercer vos droits : <Fill>{LEGAL.privacyContact}</Fill>.</p>
    ),
  },
  {
    title: "Droit applicable",
    body: (
      <p>Le site est soumis au droit de <Fill>{LEGAL.governingLaw}</Fill>. Les tribunaux de <Fill>{LEGAL.jurisdiction}</Fill> sont compétents, sous réserve des règles protectrices applicables aux consommateurs. <Fill>[À COMPLÉTER : médiation ou règlement amiable des litiges, si applicable]</Fill></p>
    ),
  },
];

function LegalNoticePage() {
  return <LegalDoc title="Mentions légales" intro={<p>Informations légales concernant le site {LEGAL.site} et son éditeur.</p>} sections={sections} />;
}
