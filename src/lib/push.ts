import { requireSupabase } from "./supabase";

/* Notifications push (migration 0071). Un seul fournisseur actif, choisi au build par VITE_PUSH_PROVIDER :
 *  - "onesignal" : SDK OneSignal ; l'appareil est rattaché au compte par OneSignal.login(<id utilisateur>) et l'envoi
 *    cible cet identifiant (Edge Function push-dispatch). Le SDK n'est chargé que pour un utilisateur qui a activé le push ici.
 *  - "webpush"   : Web Push natif (service worker /sw.js, clés VAPID) ; l'abonnement est enregistré dans push_subscriptions.
 * Rien n'est proposé à l'utilisateur tant que le fournisseur n'est pas configuré (PUSH_PROVIDER = null). Tout ce fichier
 * ne s'exécute que dans le navigateur. Non testé avec un vrai appareil : à essayer avec un compte test. */

export type PushProvider = "onesignal" | "webpush";
const RAW = import.meta.env.VITE_PUSH_PROVIDER;
const ONESIGNAL_APP_ID = import.meta.env.VITE_ONESIGNAL_APP_ID;
const ONESIGNAL_SAFARI_WEB_ID = import.meta.env.VITE_ONESIGNAL_SAFARI_WEB_ID; // facultatif : Safari sur Mac
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export const PUSH_PROVIDER: PushProvider | null =
  RAW === "onesignal" && ONESIGNAL_APP_ID ? "onesignal" : RAW === "webpush" && VAPID_PUBLIC_KEY ? "webpush" : null;

export type PushStatus = "unconfigured" | "unsupported" | "needs_install" | "denied" | "off" | "on";

export class PushUserError extends Error {}

/** Mémorise, dans ce navigateur, le compte qui a activé le push ici (évite de charger un SDK tiers pour rien, et sert à la déconnexion). */
const DEVICE_KEY = "cm_push_device";
const markDevice = (userId: string | null) => {
  try {
    if (userId) window.localStorage.setItem(DEVICE_KEY, userId);
    else window.localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* stockage indisponible : sans importance */
  }
};
const markedDevice = (): string | null => {
  try {
    return window.localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
};

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches === true || (navigator as unknown as { standalone?: boolean }).standalone === true;

/* ---------- OneSignal ---------- */

type OneSignalSdk = {
  init(options: Record<string, unknown>): Promise<void>;
  login(externalId: string): Promise<void>;
  logout(): Promise<void>;
  Notifications: { requestPermission(): Promise<void>; permission: boolean };
  User: { PushSubscription: { optIn(): Promise<void>; optOut(): Promise<void>; optedIn?: boolean } };
};
declare global {
  interface Window {
    OneSignalDeferred?: Array<(sdk: OneSignalSdk) => void | Promise<void>>;
  }
}

let oneSignalReady: Promise<OneSignalSdk> | null = null;
function loadOneSignal(): Promise<OneSignalSdk> {
  if (oneSignalReady) return oneSignalReady;
  oneSignalReady = new Promise<OneSignalSdk>((resolve, reject) => {
    const timer = window.setTimeout(() => { oneSignalReady = null; reject(new PushUserError("Le service de notifications ne répond pas. Réessayez.")); }, 15_000);
    window.OneSignalDeferred = window.OneSignalDeferred ?? [];
    window.OneSignalDeferred.push(async (sdk) => {
      try {
        await sdk.init({ appId: ONESIGNAL_APP_ID, ...(ONESIGNAL_SAFARI_WEB_ID ? { safari_web_id: ONESIGNAL_SAFARI_WEB_ID } : {}), serviceWorkerPath: "OneSignalSDKWorker.js", notifyButton: { enable: false }, allowLocalhostAsSecureOrigin: true });
        window.clearTimeout(timer);
        resolve(sdk);
      } catch (e) {
        window.clearTimeout(timer);
        oneSignalReady = null;
        reject(e);
      }
    });
    const script = document.createElement("script");
    script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    script.defer = true;
    script.onerror = () => { window.clearTimeout(timer); oneSignalReady = null; reject(new PushUserError("Impossible de charger le service de notifications (bloqueur de publicités ?).")); };
    document.head.appendChild(script);
  });
  return oneSignalReady;
}

/* ---------- Web Push natif ---------- */

function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer as ArrayBuffer;
}

async function currentWebPushSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/* ---------- Appels serveur ---------- */

async function callRpc(fn: "register_push_subscription" | "remove_push_subscription", args: Record<string, unknown>): Promise<void> {
  const { data, error } = await requireSupabase().rpc(fn, args);
  if (error) throw error;
  const r = data as { success?: boolean; error?: string } | null;
  if (!r?.success) {
    if (r?.error === "too_many_devices") throw new PushUserError("Trop d'appareils sont déjà enregistrés. Désactivez les notifications sur un autre appareil.");
    throw new PushUserError("Impossible d'enregistrer les notifications pour le moment. Réessayez.");
  }
}

/* ---------- API publique ---------- */

export async function getPushStatus(userId: string): Promise<PushStatus> {
  if (typeof window === "undefined" || !PUSH_PROVIDER) return "unconfigured";
  if (isIos() && !isStandalone()) return "needs_install"; // Safari iPhone : le push web exige l'app ajoutée à l'écran d'accueil
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  try {
    if (PUSH_PROVIDER === "webpush") return (await currentWebPushSubscription()) ? "on" : "off";
    if (markedDevice() !== userId) return "off";
    const sdk = await loadOneSignal();
    return sdk.User.PushSubscription.optedIn === true ? "on" : "off";
  } catch {
    return "off";
  }
}

export async function enablePush(userId: string): Promise<void> {
  if (!PUSH_PROVIDER) throw new PushUserError("Les notifications ne sont pas disponibles.");
  const denied = () => new PushUserError("Notifications refusées. Autorisez-les dans les réglages de votre navigateur pour ce site.");

  if (PUSH_PROVIDER === "webpush") {
    if ((await Notification.requestPermission()) !== "granted") throw denied();
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBuffer(VAPID_PUBLIC_KEY!) }));
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new PushUserError("Abonnement incomplet. Réessayez.");
    await callRpc("register_push_subscription", { p_provider: "webpush", p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth, p_user_agent: navigator.userAgent });
    markDevice(userId);
    return;
  }

  const sdk = await loadOneSignal();
  await sdk.login(userId); // external_id = identifiant CampusMarket : c'est ce que push-dispatch cible
  await sdk.Notifications.requestPermission();
  if (!sdk.Notifications.permission) throw denied();
  await sdk.User.PushSubscription.optIn();
  await callRpc("register_push_subscription", { p_provider: "onesignal", p_user_agent: navigator.userAgent });
  markDevice(userId);
}

export async function disablePush(): Promise<void> {
  if (!PUSH_PROVIDER) return;
  if (PUSH_PROVIDER === "webpush") {
    const sub = await currentWebPushSubscription();
    if (sub) {
      await callRpc("remove_push_subscription", { p_provider: "webpush", p_endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
  } else {
    const sdk = await loadOneSignal();
    await sdk.User.PushSubscription.optOut();
    // La ligne serveur « onesignal » est par compte (pas par appareil) : on la garde, d'autres appareils peuvent rester abonnés.
  }
  markDevice(null);
}

/** À appeler AVANT la déconnexion : détache cet appareil du compte pour que le suivant ne reçoive pas ses notifications. */
export async function unlinkPushDevice(): Promise<void> {
  if (typeof window === "undefined" || !PUSH_PROVIDER || !markedDevice()) return;
  try {
    if (PUSH_PROVIDER === "webpush") {
      const sub = await currentWebPushSubscription();
      if (sub) {
        await callRpc("remove_push_subscription", { p_provider: "webpush", p_endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
    } else {
      await (await loadOneSignal()).logout();
    }
  } finally {
    markDevice(null);
  }
}
