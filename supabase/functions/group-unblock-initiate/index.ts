// =============================================================================
// group-unblock-initiate — déblocage anticipé des achats groupés (500 F).
// Une personne bloquée 48 h pour un engagement non tenu (retrait ou paiement non effectué dans les 48 h) peut payer le
// déblocage par Mobile Money. Même pipeline que event-checkout-initiate : paiement + tentative CamPay ; à la confirmation,
// le trigger apply_payment_settlement lève le blocage. Le montant vient de la base (group_buy_unblock_fee), jamais du client.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { collect, detectOperator } from "../_shared/campay.ts";

const MAX_ATTEMPTS = 5;
const PHONE_REGEX = /^\+237[26]\d{8}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  let body: { phone_number?: string; idempotency_key?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { phone_number: phoneNumber, idempotency_key: idempotencyKey } = body;
  if (!idempotencyKey || !UUID_REGEX.test(idempotencyKey)) return json({ error: "invalid_idempotency_key" }, 400);
  if (!phoneNumber || !PHONE_REGEX.test(phoneNumber)) return json({ error: "invalid_phone_number" }, 400);

  const provider = detectOperator(phoneNumber);
  if (!provider) return json({ error: "unsupported_operator" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const asService = createClient(supabaseUrl, serviceRoleKey);

  const { data: authData, error: authError } = await asUser.auth.getUser();
  if (authError || !authData.user) return json({ error: "unauthorized" }, 401);
  const userId = authData.user.id;

  const { data: active } = await asUser.rpc("is_active_account");
  if (active === false) return json({ error: "account_not_active" }, 403);

  // Il faut être réellement bloqué : on ne vend pas un déblocage à qui ne l'est pas.
  const { data: block } = await asService.from("group_buy_blocks").select("blocked_until").eq("user_id", userId).gt("blocked_until", new Date().toISOString()).maybeSingle();
  if (!block) return json({ error: "not_blocked", message: "Vous n'êtes pas bloqué : vous pouvez rejoindre un achat groupé." }, 409);

  const { data: feeData, error: feeError } = await asService.rpc("group_buy_unblock_fee");
  const fee = Number(feeData);
  if (feeError || !Number.isInteger(fee) || fee <= 0) {
    console.error("group-unblock-initiate: montant introuvable", feeError);
    return json({ error: "internal_error" }, 500);
  }

  // Déblocage en attente de cette personne : réutilisé (un seul à la fois, index unique).
  let { data: unblock } = await asService.from("group_buy_unblocks").select("id").eq("user_id", userId).eq("status", "pending_payment").maybeSingle();
  if (!unblock) {
    const { data: created, error: createError } = await asService.from("group_buy_unblocks").insert({ user_id: userId, amount: fee }).select("id").single();
    if (createError || !created) {
      console.error("group-unblock-initiate: création du déblocage échouée", createError);
      return json({ error: "internal_error" }, 500);
    }
    unblock = created;
  }

  let { data: payment } = await asService.from("payments").select("id, status").eq("group_unblock_id", unblock.id).maybeSingle();
  if (!payment) {
    const { data: newPayment, error: createPaymentError } = await asService.from("payments").insert({ group_unblock_id: unblock.id, amount: fee, currency: "XAF" }).select("id, status").single();
    if (createPaymentError || !newPayment) {
      console.error("group-unblock-initiate: création du paiement échouée", createPaymentError);
      return json({ error: "internal_error" }, 500);
    }
    payment = newPayment;
  }
  if (payment.status === "success") return json({ error: "already_paid" }, 409);

  const { data: existingAttempt } = await asService.from("payment_attempts").select("id, status").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existingAttempt) return json({ attempt_id: existingAttempt.id, status: existingAttempt.status, message: "Tentative déjà enregistrée, en attente de confirmation." });

  const { count: attemptCount } = await asService.from("payment_attempts").select("id", { count: "exact", head: true }).eq("payment_id", payment.id);
  if ((attemptCount ?? 0) >= MAX_ATTEMPTS) return json({ error: "too_many_attempts" }, 429);

  const { data: attempt, error: attemptError } = await asService
    .from("payment_attempts")
    .insert({ payment_id: payment.id, idempotency_key: idempotencyKey, provider, phone_number: phoneNumber })
    .select("id")
    .single();
  if (attemptError || !attempt) {
    console.error("group-unblock-initiate: création de la tentative échouée", attemptError);
    return json({ error: "internal_error" }, 500);
  }

  try {
    const result = await collect({ amount: fee, phoneNumber, externalReference: attempt.id, description: "CampusMarket déblocage achats groupés" });
    await asService.from("payment_attempts").update({ provider_reference: result.reference }).eq("id", attempt.id);
    return json({ attempt_id: attempt.id, status: "pending", provider_reference: result.reference, message: "Confirmez le paiement sur votre téléphone." });
  } catch (err) {
    console.error("group-unblock-initiate: appel CamPay échoué", err);
    await asService.from("payment_attempts").update({ status: "failed", failure_reason: String(err) }).eq("id", attempt.id);
    return json({ error: "provider_error" }, 502);
  }
});
