// =============================================================================
// payments-reconcile — à brancher sur un cron Supabase (pg_cron ou Scheduled
// Function, ex. toutes les 5 minutes). Réf. section 47 : "réconciliation
// périodique entre base CampusMarket et état fournisseur".
//
// Rôle : rattraper deux situations que le webhook seul ne couvre pas
// - le webhook CamPay n'arrive jamais (perte réseau, endpoint temporairement
//   indisponible) ;
// - une tentative reste 'pending' au-delà de son expires_at.
// Pour chaque tentative encore pending, on interroge CamPay directement.
// Rien de plus permissif que le webhook : même passage obligé par
// getTransactionStatus avant tout changement d'état.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { getTransactionStatus } from "../_shared/campay.ts";

Deno.serve(async (req) => {
  // Protection simple : ce endpoint n'est pas destiné aux utilisateurs finaux,
  // seulement au scheduler interne (Authorization: Bearer <CRON_SECRET>).
  const cronSecret = Deno.env.get("PAYMENTS_RECONCILE_SECRET");
  const authHeader = req.headers.get("Authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: pendingAttempts, error } = await supabase
    .from("payment_attempts")
    .select("id, payment_id, provider_reference, expires_at")
    .eq("status", "pending")
    .not("provider_reference", "is", null)
    .limit(100);

  if (error) {
    console.error("payments-reconcile: lecture échouée", error);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500 });
  }

  const results = { checked: 0, settled: 0, failed: 0, expired: 0, still_pending: 0, errors: 0 };

  for (const attempt of pendingAttempts ?? []) {
    results.checked++;
    try {
      const confirmed = await getTransactionStatus(attempt.provider_reference!);

      if (confirmed.status === "SUCCESSFUL") {
        await supabase.from("payment_attempts").update({ status: "success" }).eq("id", attempt.id);
        await supabase.from("payments").update({ status: "success" }).eq("id", attempt.payment_id);
        results.settled++;
      } else if (confirmed.status === "FAILED") {
        await supabase.from("payment_attempts").update({ status: "failed" }).eq("id", attempt.id);
        results.failed++;
      } else if (new Date(attempt.expires_at) < new Date()) {
        // Toujours PENDING chez CamPay mais notre fenêtre est dépassée : on
        // referme la tentative pour laisser l'acheteur réessayer proprement,
        // sans bloquer la commande indéfiniment sur une tentative morte.
        await supabase.from("payment_attempts").update({ status: "expired" }).eq("id", attempt.id);
        results.expired++;
      } else {
        results.still_pending++;
      }
    } catch (err) {
      console.error(`payments-reconcile: échec sur attempt ${attempt.id}`, err);
      results.errors++;
    }
  }

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
