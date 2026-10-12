import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { ConfirmDialog, InlineAlert, Spinner } from "@/components/cm/feedback";
import { ProductCardSkeleton } from "@/components/cm/commerce";
import { StateSwitcher } from "@/components/cm/state-switcher";
import {
  EmptyFavoritesScreen, EmptyScreen, ForbiddenScreen, NetworkErrorScreen, NoResultsScreen, NotFoundScreen,
  OfflineScreen, ServerErrorScreen, SessionExpiredScreen, UnavailableScreen,
} from "@/components/cm/screens";
import { Block, Row } from "./Block";

const screens = [
  { id: "vide", label: "Liste vide" },
  { id: "resultats", label: "Aucun résultat" },
  { id: "filtres", label: "Filtres sans résultat" },
  { id: "favoris", label: "Favoris vides" },
  { id: "serveur", label: "Erreur serveur" },
  { id: "reseau", label: "Erreur réseau" },
  { id: "hors-ligne", label: "Hors connexion" },
  { id: "404", label: "Page introuvable" },
  { id: "refuse", label: "Accès refusé" },
  { id: "session", label: "Session expirée" },
  { id: "indisponible", label: "Indisponible" },
] as const;
type ScreenId = (typeof screens)[number]["id"];

function ScreenPreview({ id }: { id: ScreenId }) {
  switch (id) {
    case "vide": return <EmptyScreen compact title="Aucune annonce pour l'instant" description="Publiez votre première annonce pour qu'elle apparaisse ici." actions={<Button>Publier une annonce</Button>} />;
    case "resultats": return <NoResultsScreen compact query="macbook pro" />;
    case "filtres": return <NoResultsScreen compact filtered />;
    case "favoris": return <EmptyFavoritesScreen compact />;
    case "serveur": return <ServerErrorScreen compact />;
    case "reseau": return <NetworkErrorScreen compact />;
    case "hors-ligne": return <OfflineScreen compact />;
    case "404": return <NotFoundScreen compact />;
    case "refuse": return <ForbiddenScreen compact />;
    case "session": return <SessionExpiredScreen compact />;
    case "indisponible": return <UnavailableScreen compact />;
  }
}

export function FeedbackSection() {
  const [confirm, setConfirm] = useState<null | "normal" | "danger">(null);
  const [screen, setScreen] = useState<ScreenId>("vide");
  return (
    <div>
      <Block title="Notifications toast" description="Retour bref après une action. Disparaît seul, sans bloquer la page.">
        <Row>
          <Button variant="outline" onClick={() => toast.success("Annonce publiée", { description: "Elle est visible par votre campus." })}>Succès</Button>
          <Button variant="outline" onClick={() => toast.error("Publication impossible", { description: "Vérifiez votre connexion." })}>Erreur</Button>
          <Button variant="outline" onClick={() => toast.warning("Batterie faible pour l'envoi de photos")}>Alerte</Button>
          <Button variant="outline" onClick={() => toast.info("Un nouveau message vous attend")}>Information</Button>
        </Row>
      </Block>

      <Block title="Alertes intégrées" description="Messages contextuels dans la page (erreur de formulaire, information, avertissement).">
        <div className="grid gap-3 lg:grid-cols-2">
          <InlineAlert tone="info" title="Information">Les paiements Mobile Money sont confirmés en quelques secondes.</InlineAlert>
          <InlineAlert tone="success" title="Succès">Votre carte étudiante a bien été envoyée.</InlineAlert>
          <InlineAlert tone="warning" title="Attention">Cette annonce expire dans 2 jours.</InlineAlert>
          <InlineAlert tone="danger" title="Erreur">Le paiement a échoué. Aucun montant n'a été débité.</InlineAlert>
        </div>
      </Block>

      <Block title="Modale, feuille du bas et confirmation" description="Modale sur desktop, feuille du bas sur mobile, confirmation pour toute action destructive.">
        <Row>
          <Dialog>
            <DialogTrigger asChild><Button variant="outline">Ouvrir une modale</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-display">Faire une offre</DialogTitle><DialogDescription>Proposez un prix au vendeur. Il pourra accepter, refuser ou contre-proposer.</DialogDescription></DialogHeader>
              <DialogFooter className="gap-2"><Button variant="outline">Annuler</Button><Button>Envoyer l'offre</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Drawer>
            <DrawerTrigger asChild><Button variant="outline">Ouvrir une feuille du bas</Button></DrawerTrigger>
            <DrawerContent>
              <DrawerHeader><DrawerTitle className="font-display">Filtrer les annonces</DrawerTitle><DrawerDescription>Affinez par catégorie, prix, état et campus.</DrawerDescription></DrawerHeader>
              <DrawerFooter><Button>Appliquer les filtres</Button><Button variant="ghost">Réinitialiser</Button></DrawerFooter>
            </DrawerContent>
          </Drawer>
          <Button variant="outline" onClick={() => setConfirm("normal")}>Confirmation</Button>
          <Button variant="destructive" onClick={() => setConfirm("danger")}>Confirmation destructive</Button>
        </Row>
        <ConfirmDialog open={confirm === "normal"} onOpenChange={(o) => !o && setConfirm(null)} title="Publier cette annonce ?" description="Elle sera immédiatement visible par les étudiants de votre campus." confirmLabel="Publier" />
        <ConfirmDialog open={confirm === "danger"} onOpenChange={(o) => !o && setConfirm(null)} destructive title="Supprimer cette annonce ?" description="Cette action est définitive. Les conversations liées seront conservées." confirmLabel="Supprimer" />
      </Block>

      <Block title="Chargement" description="Squelettes pour les listes, spinner pour les actions, barre pour les envois.">
        <Row className="mb-5"><Spinner /><Spinner className="size-8 border-4" /><div className="h-2 w-48 overflow-hidden rounded-full bg-muted"><div className="h-full w-2/3 rounded-full bg-primary" /></div></Row>
        <div className="grid gap-4 sm:grid-cols-3"><ProductCardSkeleton /><ProductCardSkeleton /><div className="hidden sm:block"><ProductCardSkeleton /></div></div>
      </Block>

      <Block title="États vides, erreurs et accès" description="Chaque écran de la plateforme dispose de ces états transversaux.">
        <StateSwitcher states={screens} value={screen} onChange={setScreen} />
        <div className="rounded-lg border border-border bg-background"><ScreenPreview id={screen} /></div>
      </Block>
    </div>
  );
}
