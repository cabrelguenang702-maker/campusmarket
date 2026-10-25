import { useSyncExternalStore } from "react";

/* Installation de CampusMarket comme application (PWA) : même site, fenêtre dédiée avec icône, sans magasin d'applications.
 * Aucun service worker n'est enregistré ici (inutile pour l'installation dans Chrome, Edge et Safari récents, et il entrerait en
 * conflit avec celui des notifications push, un seul étant possible par site). L'application reste donc en ligne uniquement.
 * Chrome et Edge déclenchent « beforeinstallprompt » une fois le manifeste valide : on garde l'événement pour proposer notre
 * propre bouton. Ailleurs (Safari, iPhone), on affiche des consignes. */

type InstallChoice = { outcome: "accepted" | "dismissed" };
type BeforeInstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<InstallChoice> };

export type InstallState = "unknown" | "installed" | "available" | "ios" | "manual";

let deferred: BeforeInstallPromptEvent | null = null;
let installedNow = false;
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** À appeler une fois, tôt : l'événement peut arriver avant que l'interface soit affichée. */
export function startPwaInstall() {
  if (typeof window === "undefined" || started) return;
  started = true;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; emit(); });
  window.addEventListener("appinstalled", () => { deferred = null; installedNow = true; emit(); });
}
startPwaInstall();

const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches === true || (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function snapshot(): InstallState {
  if (installedNow || isStandalone()) return "installed";
  if (deferred) return "available";
  if (isIos()) return "ios";
  return "manual";
}

export function usePwaInstall() {
  const state = useSyncExternalStore<InstallState>(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    snapshot,
    () => "unknown",
  );
  const install = async (): Promise<boolean> => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null; // l'événement ne peut servir qu'une fois
    emit();
    return outcome === "accepted";
  };
  return { state, install };
}
