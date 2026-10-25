// =============================================================================
// push-dispatch — vide la file notification_push_queue (0071) : envoie une notification push
// à l'utilisateur concerné. À planifier comme notifications-dispatch (pg_cron + pg_net,
// toutes les minutes). Protégée par le même secret partagé (NOTIFICATIONS_DISPATCH_SECRET).
//
// Un seul fournisseur actif, choisi par PUSH_PROVIDER :
//   onesignal — ONESIGNAL_APP_ID, ONESIGNAL_API_KEY. L'utilisateur est ciblé par external_id
//               (= son identifiant CampusMarket, posé par OneSignal.login côté application).
//   webpush   — VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…). Les abonnements
//               viennent de la table push_subscriptions ; ceux que le navigateur déclare
//               expirés (404/410) sont supprimés.
// APP_URL (ex. https://campusmarket.app) sert aux liens ouverts au clic.
//
// Contenu volontairement générique (comme l'e-mail, section 18 « payload minimal ») : ni texte de
// message ni donnée sensible ne transitent par un service tiers. Le détail vit dans l'application.
//
// NON TESTÉ en conditions réelles (aucune clé, aucun appareil) : à essayer avec un compte test.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;

const TITLES: Record<string, string> = {
  message: "Nouveau message",
  achat: "Votre achat ou vente",
  produit: "Votre annonce",
  groupe: "Votre communauté",
  evenement: "Votre événement",
  formation: "Votre formation",
  systeme: "Information CampusMarket",
  securite: "Alerte de sécurité",
};
const BODY = "Ouvrez CampusMarket pour la consulter.";

class PushError extends Error {
  constructor(message: string, readonly permanent: boolean) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// --- OneSignal ---------------------------------------------------------------

async function sendOneSignal(userId: string, notificationId: string, title: string, url: string) {
  const appId = Deno.env.get("ONESIGNAL_APP_ID");
  const apiKey = Deno.env.get("ONESIGNAL_API_KEY");
  if (!appId || !apiKey) throw new PushError("OneSignal non configuré (ONESIGNAL_APP_ID / ONESIGNAL_API_KEY)", true);

  const res = await fetch("https://api.onesignal.com/notifications?c=push", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Key ${apiKey}` },
    body: JSON.stringify({
      app_id: appId,
      target_channel: "push",
      include_aliases: { external_id: [userId] },
      headings: { en: title, fr: title },
      contents: { en: BODY, fr: BODY },
      url,
      idempotency_key: notificationId, // un renvoi après erreur réseau ne crée pas de doublon
    }),
  });

  const text = await res.text();
  if (res.status === 429 || res.status >= 500) throw new PushError(`OneSignal ${res.status}`, false);
  if (!res.ok) throw new PushError(`OneSignal ${res.status}: ${text.slice(0, 300)}`, true);

  // 200 sans destinataire abonné : OneSignal répond OK avec une liste d'erreurs et pas d'identifiant.
  let parsed: { id?: string; errors?: unknown } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* réponse non JSON : on la considère acceptée */
  }
  if (!parsed.id && parsed.errors) throw new PushError(`OneSignal : aucun destinataire (${JSON.stringify(parsed.errors).slice(0, 200)})`, true);
}

// --- Web Push natif ------------------------------------------------------------

// deno-lint-ignore no-explicit-any
let webpushLib: any = null;

async function sendWebPush(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  notificationId: string,
  title: string,
  url: string,
) {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) throw new PushError("Web Push non configuré (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT)", true);

  if (!webpushLib) {
    const mod = await import("npm:web-push@3.6.7");
    webpushLib = mod.default ?? mod;
    webpushLib.setVapidDetails(subject, publicKey, privateKey);
  }

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId)
    .eq("provider", "webpush");
  if (error) throw new PushError(`lecture des abonnements : ${error.message}`, false);
  if (!subs || subs.length === 0) throw new PushError("aucun appareil abonné", true);

  const payload = JSON.stringify({ title, body: BODY, url, tag: notificationId });
  let delivered = 0;
  let transient: string | null = null;

  for (const s of subs) {
    try {
      await webpushLib.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24, urgency: "normal" });
      delivered++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // Abonnement expiré ou révoqué par l'utilisateur dans son navigateur.
        await supabase.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        transient = `Web Push ${status ?? "réseau"}: ${String(err).slice(0, 200)}`;
      }
    }
  }

  if (delivered > 0) return;
  if (transient) throw new PushError(transient, false);
  throw new PushError("tous les abonnements étaient expirés", true);
}

// --- Boucle principale ---------------------------------------------------------

Deno.serve(async (req) => {
  const secret = Deno.env.get("NOTIFICATIONS_DISPATCH_SECRET");
  if (!secret || req.headers.get("Authorization") !== `Bearer ${secret}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const provider = Deno.env.get("PUSH_PROVIDER");
  if (provider !== "onesignal" && provider !== "webpush") {
    // Aucun fournisseur choisi : on ne touche pas à la file (rien n'est perdu), on le dit clairement.
    return json({ error: "push_not_configured", message: "PUSH_PROVIDER doit valoir onesignal ou webpush" }, 503);
  }

  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  const url = `${appUrl}/notifications`;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: batch, error } = await supabase
    .from("notification_push_queue")
    .select("id, user_id, notification_id, attempts, notifications ( category )")
    .eq("status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error("push-dispatch: lecture de la file échouée", error);
    return json({ error: "internal_error" }, 500);
  }

  const results = { sent: 0, failed: 0 };

  for (const item of batch ?? []) {
    // deno-lint-ignore no-explicit-any
    const category = (item as any).notifications?.category ?? "systeme";
    const title = TITLES[category] ?? TITLES.systeme;
    const attempts = item.attempts + 1;

    try {
      if (provider === "onesignal") await sendOneSignal(item.user_id, item.notification_id, title, url);
      else await sendWebPush(supabase, item.user_id, item.notification_id, title, url);

      await supabase.from("notification_push_queue")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts })
        .eq("id", item.id);
      results.sent++;
    } catch (err) {
      const permanent = err instanceof PushError && err.permanent;
      await supabase.from("notification_push_queue")
        .update({
          status: permanent || attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          last_error: String(err).slice(0, 500),
          attempts,
        })
        .eq("id", item.id);
      results.failed++;
    }
  }

  return json(results);
});
