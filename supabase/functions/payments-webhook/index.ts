// =============================================================================
// payments-webhook — réception des notifications CamPay. Endpoint public (pas
// de JWT utilisateur : c'est CamPay qui appelle), donc TOUTE la sécurité
// repose sur la vérification ci-dessous, pas sur l'authentification Supabase.
//
// Réf. Backend_Hardened section 15 et section 47. Règles appliquées dans
// l'ordre :
// 0. FAIL-CLOSED : sans CAMPAY_WEBHOOK_KEY l'endpoint refuse tout (503), sauf opt-in
//    explicite ALLOW_UNSIGNED_WEBHOOKS=true réservé à la sandbox. Avec la clé, une
//    signature ABSENTE ou invalide est rejetée (401) AVANT toute écriture en base.
//    (Avant : une signature absente était traitée comme "non vérifiée" et passait ;
//    et un événement falsifié consommait la clé d'idempotence de l'événement légitime,
//    qui était alors ignoré comme "déjà traité".)
// 1. Le corps brut est journalisé dans provider_events avant tout traitement
//    métier, avec une contrainte unique (provider, external_event_id) qui
//    rend le traitement idempotent même si CamPay renvoie deux fois le même
//    événement (retry de son côté).
// 2. On ne fait JAMAIS confiance au statut annoncé dans le corps du webhook,
//    même une fois la signature vérifiée : on rappelle CamPay
//    (getTransactionStatus) pour confirmer, avant de modifier quoi que ce
//    soit. Défense en profondeur contre un webhook rejoué ou un statut
//    obsolète.
// 3. Le webhook ne peut jamais lui-même écrire "success" sans cette
//    reconfirmation server-to-server, quel que soit son contenu.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { getTransactionStatus, verifyWebhookSignature, type CampayTransactionStatus } from "../_shared/campay.ts";

function mapStatus(status: CampayTransactionStatus): "success" | "failed" | "pending" {
  if (status === "SUCCESSFUL") return "success";
  if (status === "FAILED") return "failed";
  return "pending";
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  // On répond 200 par défaut dès que l'événement est journalisé, même si le
  // traitement métier échoue ensuite : la réconciliation périodique
  // (payments-reconcile) rattrape les cas non traités plutôt que de laisser
  // CamPay marteler l'endpoint en retry pendant 24h pour une erreur interne.
  const ackJson = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") {
    return ackJson({ error: "method_not_allowed" }, 405);
  }

  // Taille bornée avant tout traitement : un corps géant ne doit pas atteindre JSON.parse ni la base.
  const MAX_BODY_BYTES = 65_536;
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return ackJson({ error: "payload_too_large" }, 413);
  }
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return ackJson({ error: "payload_too_large" }, 413);
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return ackJson({ error: "invalid_json" }, 400);
  }

  const externalEventId = String(payload.reference ?? "");
  const attemptId = String(payload.external_reference ?? "");
  const signature = payload.signature ? String(payload.signature) : null;

  if (!externalEventId || !attemptId) {
    return ackJson({ error: "missing_reference" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Vérification de la signature JWT (voir _shared/campay.ts), AVANT toute écriture.
  const webhookKey = Deno.env.get("CAMPAY_WEBHOOK_KEY");
  const allowUnsigned = Deno.env.get("ALLOW_UNSIGNED_WEBHOOKS") === "true";
  let signatureValid = false;

  if (webhookKey) {
    if (!signature || !(await verifyWebhookSignature(signature, webhookKey))) {
      // Rien n'est écrit : ni provider_events (clé d'idempotence), ni appel à CamPay.
      // La référence est tronquée dans le log pour ne pas devenir un vecteur d'injection de logs.
      console.warn("payments-webhook: signature absente ou invalide", externalEventId.slice(0, 40));
      return ackJson({ error: "invalid_signature" }, 401);
    }
    signatureValid = true;
  } else if (!allowUnsigned) {
    console.error("payments-webhook: CAMPAY_WEBHOOK_KEY non configurée — requête refusée (fail-closed)");
    return ackJson({ error: "webhook_not_configured" }, 503);
  }

  // Étape 1 — journalisation append-only + dédoublonnage. Si cet événement a
  // déjà été reçu, l'insert échoue sur la contrainte unique : on répond 200
  // immédiatement sans rien retraiter (idempotence, section 15).
  const { data: eventRow, error: insertError } = await supabase
    .from("provider_events")
    .insert({
      provider: "mtn_momo", // valeur affinée juste après via payment_attempts.provider
      external_event_id: externalEventId,
      signature_valid: signatureValid,
      raw_payload: payload,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      // unique_violation : événement déjà traité, c'est le comportement attendu.
      return ackJson({ status: "already_processed" });
    }
    console.error("payments-webhook: insertion provider_events échouée", insertError);
    return ackJson({ error: "internal_error" }, 500);
  }

  try {
    const { data: attempt, error: attemptError } = await supabase
      .from("payment_attempts")
      .select("id, payment_id, status, provider")
      .eq("id", attemptId)
      .maybeSingle();

    if (attemptError || !attempt) {
      await supabase
        .from("provider_events")
        .update({ processing_status: "ignored", processing_error: "attempt_not_found", processed_at: new Date().toISOString() })
        .eq("id", eventRow.id);
      return ackJson({ status: "ignored" });
    }

    await supabase.from("provider_events").update({ provider: attempt.provider }).eq("id", eventRow.id);
    await supabase.from("provider_events").update({ payment_attempt_id: attempt.id }).eq("id", eventRow.id);

    if (attempt.status !== "pending") {
      // Déjà résolue (succès/échec précédent) : rien à refaire, on acquitte.
      await supabase
        .from("provider_events")
        .update({ processing_status: "ignored", processing_error: "attempt_already_resolved", processed_at: new Date().toISOString() })
        .eq("id", eventRow.id);
      return ackJson({ status: "already_resolved" });
    }

    // Étape 2 — reconfirmation server-to-server, jamais le corps du webhook seul.
    const confirmed = await getTransactionStatus(externalEventId);
    const mappedStatus = mapStatus(confirmed.status);

    if (mappedStatus === "pending") {
      // CamPay confirme "toujours en attente" malgré l'appel webhook : rien à
      // changer, on attend soit un nouveau webhook, soit la réconciliation.
      await supabase
        .from("provider_events")
        .update({ processing_status: "processed", processed_at: new Date().toISOString() })
        .eq("id", eventRow.id);
      return ackJson({ status: "still_pending" });
    }

    await supabase.from("payment_attempts").update({ status: mappedStatus }).eq("id", attempt.id);

    if (mappedStatus === "success") {
      await supabase.from("payments").update({ status: "success" }).eq("id", attempt.payment_id);
    }

    await supabase
      .from("provider_events")
      .update({ processing_status: "processed", processed_at: new Date().toISOString() })
      .eq("id", eventRow.id);

    return ackJson({ status: "ok" });
  } catch (err) {
    console.error("payments-webhook: traitement échoué", err);
    await supabase
      .from("provider_events")
      .update({ processing_status: "error", processing_error: String(err), processed_at: new Date().toISOString() })
      .eq("id", eventRow.id);
    // 200 volontaire : l'événement brut est sauvegardé, la réconciliation
    // périodique rattrapera l'état réel auprès de CamPay.
    return ackJson({ status: "logged_with_error" });
  }
});
