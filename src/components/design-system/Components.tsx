import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Send, Trash, Download } from "@/components/icons";
import { Avatar, FavoriteButton, Price, ProductCard, SellerCard } from "@/components/cm/commerce";
import { ConditionBadge, LocationBadge, RatingStars, StatusBadge, StockIndicator, VerificationBadge, statusMap, type StatusKey } from "@/components/cm/badges";
import { Breadcrumbs } from "@/components/layout/PageHeader";
import { LoadingButtonLabel } from "@/components/cm/feedback";
import { Stepper } from "@/components/cm/stepper";
import { PaymentFlow, paymentStateOptions, type PaymentMethod, type PaymentState } from "@/components/cm/payment";
import { StateSwitcher } from "@/components/cm/state-switcher";
import { GroupProgress } from "@/components/marketplace/GroupBuy";
import { ProductGallery } from "@/components/marketplace/ProductGallery";
import { QuantityStepper } from "@/components/marketplace/OrderSummary";
import { Bubble, TypingIndicator } from "@/components/messages/Bubble";
import { SettingRow, SettingsCard } from "@/components/cm/setting-row";
import { SpaceCard } from "@/components/community/SpaceCard";
import { JoinButton } from "@/components/community/JoinButton";
import { countries, products, sellers } from "@/lib/mock-data";
import { Block, Row } from "./Block";

export function ComponentsSection() {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(2);
  const [qty, setQty] = useState(1);
  const [payState, setPayState] = useState<PaymentState>("choix");
  const [method, setMethod] = useState<PaymentMethod>("mtn");
  const [phone, setPhone] = useState("");
  return (
    <div>
      <Block title="Boutons" description="Un bouton principal par écran. Hauteur tactile de 40 px (44 px en « lg »).">
        <Row>
          <Button>Principal</Button>
          <Button variant="secondary">Secondaire</Button>
          <Button variant="outline">Contour</Button>
          <Button variant="soft">Doux</Button>
          <Button variant="ghost">Fantôme</Button>
          <Button variant="destructive"><Trash /> Supprimer</Button>
          <Button variant="link">Lien</Button>
        </Row>
        <Row className="mt-4">
          <Button size="sm">Petit</Button>
          <Button size="lg">Grand</Button>
          <Button size="icon" aria-label="Ajouter"><Plus /></Button>
          <Button><Send /> Avec icône</Button>
          <Button variant="outline"><Download /> Télécharger</Button>
          <Button disabled>Désactivé</Button>
          <Button onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1600); }} disabled={loading}>
            <LoadingButtonLabel loading={loading} loadingText="Envoi…">Chargement</LoadingButtonLabel>
          </Button>
        </Row>
      </Block>

      <Block title="Statuts" description="Un seul vocabulaire de statuts pour les annonces, commandes, paiements, tickets et la modération.">
        <Row className="gap-2">{(Object.keys(statusMap) as StatusKey[]).map((s) => <StatusBadge key={s} status={s} />)}</Row>
      </Block>

      <Block title="Badges de confiance et de contexte">
        <Row>
          <VerificationBadge /><VerificationBadge compact /><VerificationBadge verified={false} />
          <LocationBadge campus="UY1" city="Yaoundé" />
          <span className="rounded-md bg-muted p-1.5"><ConditionBadge condition="Très bon état" /></span>
        </Row>
        <Row className="mt-4">
          <StockIndicator stock="available" /><StockIndicator stock="low" /><StockIndicator stock="reserved" /><StockIndicator stock="sold" /><StockIndicator stock="expired" />
        </Row>
        <Row className="mt-4"><RatingStars value={4.8} reviews={23} /><RatingStars value={3.5} size="md" /><RatingStars value={5} reviews={42} /></Row>
      </Block>

      <Block title="Prix, favori, avatar">
        <Row className="gap-8">
          <Price value={450000} oldPrice={520000} size="lg" />
          <Price value={25000} />
          <Price value={5000} size="sm" />
          <FavoriteButton /><FavoriteButton defaultActive />
          <Avatar name="Jean Dupont" size="sm" /><Avatar name="Aïcha Mbarga" /><Avatar name="Kevin Fotso" size="lg" />
        </Row>
      </Block>

      <Block title="Carte produit" description="Grille (défaut) ou ligne. Les états vendu / réservé / expiré s'affichent directement sur le visuel.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[products[0], products[3], products[5]].map((p) => p && <ProductCard key={p.id} product={p} />)}
        </div>
        <div className="mt-4 max-w-2xl">{products[1] && <ProductCard product={products[1]} layout="row" />}</div>
      </Block>

      <Block title="Carte vendeur">
        <div className="grid gap-4 sm:grid-cols-2"><SellerCard seller={sellers[0]!} /><SellerCard compact seller={{ id: "k", name: "Kevin Fotso", campus: "IUC · Douala", listings: 3, sales: 4, rating: 4.2, reviews: 4, verified: false, since: "Membre depuis 2026", avatarUrl: null }} /></div>
      </Block>

      <Block title="Étapes, progression et quantité" description="Utilisés par le checkout, la publication d'annonce et les achats groupés.">
        <Stepper steps={["Récapitulatif", "Informations", "Paiement", "Confirmation"]} current={step} />
        <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" disabled={step <= 1} onClick={() => setStep(step - 1)}>Précédent</Button><Button size="sm" variant="outline" disabled={step >= 4} onClick={() => setStep(step + 1)}>Suivant</Button></div>
        <div className="mt-6 grid gap-6 sm:grid-cols-2"><GroupProgress joined={14} target={20} /><div className="flex items-center gap-3 text-sm"><span className="text-muted-foreground">Quantité</span><QuantityStepper value={qty} max={5} onChange={setQty} /></div></div>
      </Block>

      <Block title="Galerie produit" description="Image principale, vignettes et affichage plein écran.">
        <div className="max-w-md">{products[0] && <ProductGallery product={products[0]} />}</div>
      </Block>

      <Block title="Paiement Mobile Money" description="Parcours commun au checkout, à l'achat groupé et (plus tard) à la billetterie : six états.">
        <StateSwitcher states={paymentStateOptions} value={payState} onChange={setPayState} />
        <div className="max-w-md"><PaymentFlow amount={452000} state={payState} onStateChange={setPayState} method={method} onMethodChange={setMethod} country={countries[0]!} phone={phone} onPhoneChange={setPhone} onContinue={() => setPayState("choix")} /></div>
      </Block>

      <Block title="Messagerie et réglages" description="Bulles de message avec tous les statuts d'envoi, indicateur de saisie et lignes de réglage.">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <Bubble message={{ id: "d1", from: "them", text: "Bonjour, l'article est-il toujours disponible ?", time: "09:44" }} />
            <Bubble message={{ id: "d2", from: "me", text: "Oui, vous pouvez passer demain.", time: "09:45", status: "read" }} />
            <Bubble message={{ id: "d3", from: "me", text: "Message en cours d'envoi", time: "09:46", status: "sending" }} />
            <Bubble message={{ id: "d4", from: "me", text: "Message hors connexion", time: "09:46", status: "queued" }} />
            <Bubble message={{ id: "d5", from: "me", text: "Message non envoyé", time: "09:47", status: "failed" }} onRetry={() => {}} />
            <Bubble message={{ id: "d6", from: "them", time: "09:48", attachment: { kind: "file", name: "recu-paiement.pdf", size: "92 Ko" } }} />
            <TypingIndicator />
          </div>
          <SettingsCard title="Lignes de réglage"><SettingRow id="ds-s1" label="Notifications de messages" description="Recevez une alerte à chaque nouveau message." checked onCheckedChange={() => {}} /><div className="border-t border-border" /><SettingRow id="ds-s2" label="Mode discret" description="Masquer votre statut en ligne." checked={false} onCheckedChange={() => {}} /></SettingsCard>
        </div>
      </Block>

      <Block title="Fil d\'Ariane">
        <Breadcrumbs items={[{ label: "Accueil", to: "/" }, { label: "Marketplace", to: "/marketplace" }, { label: "Ordinateurs", to: "/marketplace" }, { label: "MacBook Air M2" }]} />
        <p className="text-xs text-muted-foreground">Sidebar, en-tête, menu utilisateur, notifications et navigation basse mobile sont visibles en direct sur cette page.</p>
      </Block>
    </div>
  );
}
