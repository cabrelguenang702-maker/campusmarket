// =============================================================================
// payments-initiate — déclenche une demande de paiement CamPay pour une
// commande existante. Réf. Backend_Hardened sections 15 et 47.
//
// Principes appliqués :
// - Le montant vient TOUJOURS de orders.total_amount côté serveur, jamais du
//   corps de la requête (section 47, "aucune confiance dans amount... venant
//   du frontend").
// - idempotency_key fournie par le client (uuid v4 généré à chaque tentative
//   d'appui sur "Payer") : un retry réseau sur le même clic ne crée jamais
//   deux tentatives ni deux débits.
// - L'identité de l'appelant est vérifiée via son propre JWT (client "asUser"
//   ci-dessous, RLS active) ; toutes les écritures ensuite passent par le
//   client service_role, jamais l'inverse.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { collect, detectOperator } from "../_shared/campay.ts";

const MAX_ATTEMPTS_PER_PAYMENT = 5;
const PHONE_REGEX = /^\+237[26]\d{8}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: { order_id?: string; phone_number?: string; idempotency_key?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { order_id, phone_number, idempotency_key } = body;

  if (!order_id || !UUID_REGEX.test(order_id)) {
    return json({ error: "invalid_order_id" }, 400);
  }
  if (!idempotency_key || !UUID_REGEX.test(idempotency_key)) {
    return json({ error: "invalid_idempotency_key" }, 400);
  }
  if (!phone_number || !PHONE_REGEX.test(phone_number)) {
    return json({ error: "invalid_phone_number" }, 400);
  }

  const provider = detectOperator(phone_number);
  if (!provider) {
    return json({ error: "unsupported_operator" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Client "asUser" : RLS active, sert uniquement à vérifier que l'appelant
  // est bien l'acheteur de cette commande — jamais à écrire quoi que ce soit.
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const asService = createClient(supabaseUrl, serviceRoleKey);

  const { data: authData, error: authError } = await asUser.auth.getUser();
  if (authError || !authData.user) {
    return json({ error: "unauthorized" }, 401);
  }
  const buyerId = authData.user.id;

  const { data: order, error: orderError } = await asUser
    .from("orders")
    .select("id, buyer_id, status, total_amount")
    .eq("id", order_id)
    .single();

  if (orderError || !order) {
    // RLS masque les commandes qui ne sont pas les nôtres : un 404 générique
    // ne distingue pas "n'existe pas" de "pas à toi" (pas d'énumération).
    return json({ error: "order_not_found" }, 404);
  }
  if (order.buyer_id !== buyerId) {
    return json({ error: "order_not_found" }, 404);
  }
  if (order.status !== "pending_payment") {
    return json({ error: "order_not_payable", status: order.status }, 409);
  }

  // Récupère ou crée l'entité payments pour cette commande (une seule par
  // commande — voir contrainte unique sur payments.order_id).
  let { data: payment } = await asService
    .from("payments")
    .select("id, status")
    .eq("order_id", order_id)
    .maybeSingle();

  if (!payment) {
    const { data: newPayment, error: createError } = await asService
      .from("payments")
      .insert({ order_id, amount: order.total_amount, currency: "XAF" })
      .select("id, status")
      .single();
    if (createError || !newPayment) {
      console.error("payments-initiate: création payment échouée", createError);
      return json({ error: "internal_error" }, 500);
    }
    payment = newPayment;
  }

  if (payment.status === "success") {
    return json({ error: "already_paid" }, 409);
  }
  if (payment.status === "refunded") {
    return json({ error: "already_refunded" }, 409);
  }

  // Idempotence : si cette idempotency_key a déjà été utilisée (retry réseau
  // du même clic), on renvoie la tentative existante sans rappeler CamPay.
  const { data: existingAttempt } = await asService
    .from("payment_attempts")
    .select("id, status, provider_reference")
    .eq("idempotency_key", idempotency_key)
    .maybeSingle();

  if (existingAttempt) {
    return json({
      attempt_id: existingAttempt.id,
      status: existingAttempt.status,
      message: "Tentative déjà enregistrée, en attente de confirmation.",
    });
  }

  // Anti-abus simple : on borne le nombre de tentatives par paiement (au-delà,
  // il faut contacter le support plutôt que boucler indéfiniment).
  const { count: attemptCount } = await asService
    .from("payment_attempts")
    .select("id", { count: "exact", head: true })
    .eq("payment_id", payment.id);

  if ((attemptCount ?? 0) >= MAX_ATTEMPTS_PER_PAYMENT) {
    return json({ error: "too_many_attempts" }, 429);
  }

  // On crée la tentative en 'pending' AVANT d'appeler le prestataire (section
  // 15 : "créer une payment_attempt avant appel au prestataire") pour ne
  // jamais avoir un débit chez CamPay sans trace côté CampusMarket.
  const { data: attempt, error: attemptError } = await asService
    .from("payment_attempts")
    .insert({
      payment_id: payment.id,
      idempotency_key,
      provider,
      phone_number,
    })
    .select("id")
    .single();

  if (attemptError || !attempt) {
    console.error("payments-initiate: création attempt échouée", attemptError);
    return json({ error: "internal_error" }, 500);
  }

  try {
    const result = await collect({
      amount: order.total_amount,
      phoneNumber: phone_number,
      externalReference: attempt.id,
      description: `CampusMarket commande ${order_id.slice(0, 8)}`,
    });

    await asService
      .from("payment_attempts")
      .update({ provider_reference: result.reference })
      .eq("id", attempt.id);

    return json({
      attempt_id: attempt.id,
      status: "pending",
      provider_reference: result.reference,
      message: "Confirmez le paiement sur votre téléphone.",
    });
  } catch (err) {
    console.error("payments-initiate: appel CamPay échoué", err);
    await asService
      .from("payment_attempts")
      .update({ status: "failed", failure_reason: String(err) })
      .eq("id", attempt.id);

    return json({ error: "provider_error" }, 502);
  }
});
