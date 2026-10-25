import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/cm/setting-row";
import { InlineAlert } from "@/components/cm/feedback";
import { Download } from "@/components/icons";
import { usePwaInstall } from "@/lib/pwa";

/** Installer CampusMarket sur l'appareil (ordinateur, Android ou iPhone) : s'ouvre dans sa propre fenêtre, avec son icône. */
export function InstallApp() {
  const { state, install } = usePwaInstall();
  if (state === "unknown") return null;

  return (
    <SettingsCard title="Application sur votre appareil" description="Installez CampusMarket pour l'ouvrir comme une application, dans sa propre fenêtre et avec son icône, sans passer par un magasin d'applications.">
      {state === "installed" ? (
        <p className="text-sm">CampusMarket est déjà installé sur cet appareil.</p>
      ) : state === "available" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Gratuit, rapide, et mis à jour automatiquement.</p>
          <Button size="sm" onClick={() => void install().then((ok) => { if (ok) toast.success("CampusMarket est en cours d'installation"); })}><Download /> Installer l'application</Button>
        </div>
      ) : state === "ios" ? (
        <InlineAlert tone="info" title="Sur iPhone et iPad">Touchez le bouton Partager de Safari, puis « Sur l'écran d'accueil ». L'icône CampusMarket apparaît ensuite avec vos autres applications.</InlineAlert>
      ) : (
        <InlineAlert tone="info" title="Installer depuis votre navigateur">
          Dans Chrome ou Edge, cliquez sur l'icône d'installation à droite de la barre d'adresse (ou ouvrez le menu, puis « Installer CampusMarket »). Dans Safari sur Mac : menu Fichier, puis « Ajouter au Dock ». Firefox sur ordinateur ne permet pas l'installation.
        </InlineAlert>
      )}
    </SettingsCard>
  );
}
