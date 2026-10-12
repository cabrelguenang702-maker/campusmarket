// =============================================================================
// notifications-dispatch — vide la file notification_email_queue. À planifier
// (pg_cron + pg_net, comme payments-reconcile, ex. toutes les minutes).
// Protégé par un secret partagé : pas destiné aux utilisateurs finaux.
//
// Le corps de l'e-mail est volontairement générique (catégorie + invitation à
// ouvrir l'application) : ni contenu de message ni donnée sensible ne sortent
// par e-mail (section 18, "payload minimal"). Le détail vit dans l'application.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { EmailError, sendEmail } from "../_shared/email.ts";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;

const SUBJECTS: Record<string, string> = {
  message: "Nouveau message sur CampusMarket",
  achat: "Mise à jour de votre achat ou vente sur CampusMarket",
  produit: "Activité sur votre annonce CampusMarket",
  groupe: "Activité dans votre communauté CampusMarket",
  evenement: "Votre événement CampusMarket",
  formation: "Votre formation CampusMarket",
  systeme: "Information importante de CampusMarket",
  securite: "Alerte de sécurité sur votre compte CampusMarket",
};

Deno.serve(async (req) => {
  const secret = Deno.env.get("NOTIFICATIONS_DISPATCH_SECRET");
  if (!secret || req.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: batch, error } = await supabase
    .from("notification_email_queue")
    .select("id, user_id, attempts, notifications ( category )")
    .eq("status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error("notifications-dispatch: lecture de la file échouée", error);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500 });
  }

  const results = { sent: 0, failed: 0, skipped: 0 };

  for (const item of batch ?? []) {
    const { data: priv } = await supabase.from("profile_private").select("email").eq("id", item.user_id).maybeSingle();

    if (!priv?.email) {
      await supabase.from("notification_email_queue")
        .update({ status: "failed", last_error: "adresse e-mail introuvable", attempts: item.attempts + 1 })
        .eq("id", item.id);
      results.skipped++;
      continue;
    }

    // deno-lint-ignore no-explicit-any
    const category = (item as any).notifications?.category ?? "systeme";

    try {
      await sendEmail(
        priv.email,
        SUBJECTS[category] ?? SUBJECTS.systeme,
        "Vous avez une nouvelle notification. Ouvrez CampusMarket pour la consulter.",
      );
      await supabase.from("notification_email_queue")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts: item.attempts + 1 })
        .eq("id", item.id);
      results.sent++;
    } catch (err) {
      const attempts = item.attempts + 1;
      // Erreur permanente (clé invalide, expéditeur non vérifié, destinataire
      // refusé, prestataire non configuré) : réessayer ne change rien et
      // martèlerait le prestataire — on ferme tout de suite. Transitoire
      // (429, 5xx, réseau) : on réessaie jusqu'à MAX_ATTEMPTS.
      const permanent = err instanceof EmailError && err.permanent;
      await supabase.from("notification_email_queue")
        .update({
          status: permanent || attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          last_error: String(err).slice(0, 500),
          attempts,
        })
        .eq("id", item.id);
      results.failed++;
    }
  }

  return new Response(JSON.stringify(results), { status: 200, headers: { "Content-Type": "application/json" } });
});
