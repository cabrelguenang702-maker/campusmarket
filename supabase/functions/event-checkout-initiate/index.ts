// =============================================================================
// event-checkout-initiate — équivalent de course-checkout-initiate pour un billet d'événement payant.
// Réutilise le client CamPay ; les garde-fous (tentatives, idempotence, opérateur) sont ceux de course-checkout-initiate.
// Le billet est créé « en attente de paiement » (15 min) et réserve une place ; il devient « valide » quand le paiement est
// confirmé (trigger apply_payment_settlement). Un billet annulé ou expiré n'est jamais réactivé : on en crée un nouveau.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { collect, detectOperator } from "../_shared/campay.ts";

const MAX_ATTEMPTS_PER_TICKET = 5;
const PENDING_MINUTES = 15;
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

  let body: { event_id?: string; phone_number?: string; idempotency_key?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { event_id: eventId, phone_number: phoneNumber, idempotency_key: idempotencyKey } = body;
  if (!eventId || !UUID_REGEX.test(eventId)) return json({ error: "invalid_event_id" }, 400);
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

  // Compte actif (ni suspendu ni désactivé) : même règle que les autres actions d'achat.
  const { data: active } = await asUser.rpc("is_active_account");
  if (active === false) return json({ error: "account_not_active" }, 403);

  const { data: event, error: eventError } = await asUser
    .from("events")
    .select("id, price, status, starts_at, ends_at")
    .eq("id", eventId)
    .eq("status", "published")
    .single();

  if (eventError || !event) return json({ error: "event_not_found" }, 404);
  if (event.price === 0) return json({ error: "event_is_free", message: "Inscrivez-vous directement, aucun paiement requis" }, 409);
  const endsAt = event.ends_at ? new Date(event.ends_at).getTime() : new Date(event.starts_at).getTime() + 6 * 3600_000;
  if (endsAt <= Date.now()) return json({ error: "event_ended" }, 409);

  // Billet actif de cette personne : valide/utilisé = déjà inscrit ; en attente = on le réutilise (et on prolonge son délai).
  const { data: existing } = await asService
    .from("event_tickets")
    .select("id, status")
    .eq("event_id", eventId)
    .eq("attendee_id", userId)
    .in("status", ["pending_payment", "valid", "used"])
    .maybeSingle();

  if (existing && existing.status !== "pending_payment") return json({ error: "already_registered" }, 409);

  let ticketId = existing?.id as string | undefined;
  if (ticketId) {
    await asService.from("event_tickets").update({ expires_at: new Date(Date.now() + PENDING_MINUTES * 60_000).toISOString() }).eq("id", ticketId);
  } else {
    const { data: created, error: createError } = await asService
      .from("event_tickets")
      .insert({ event_id: eventId, attendee_id: userId, unit_price: event.price, idempotency_key: idempotencyKey, status: "pending_payment" })
      .select("id")
      .single();
    if (createError || !created) {
      const message = String(createError?.message ?? "");
      if (message.includes("Capacité atteinte")) return json({ error: "sold_out" }, 409);
      if (message.includes("terminé")) return json({ error: "event_ended" }, 409);
      console.error("event-checkout-initiate: création du billet échouée", createError);
      return json({ error: "internal_error" }, 500);
    }
    ticketId = created.id;
  }

  let { data: payment } = await asService.from("payments").select("id, status").eq("event_ticket_id", ticketId).maybeSingle();
  if (!payment) {
    const { data: newPayment, error: createPaymentError } = await asService
      .from("payments")
      .insert({ event_ticket_id: ticketId, amount: event.price, currency: "XAF" })
      .select("id, status")
      .single();
    if (createPaymentError || !newPayment) {
      console.error("event-checkout-initiate: création du paiement échouée", createPaymentError);
      return json({ error: "internal_error" }, 500);
    }
    payment = newPayment;
  }

  if (payment.status === "success") return json({ error: "already_paid" }, 409);

  const { data: existingAttempt } = await asService
    .from("payment_attempts")
    .select("id, status, provider_reference")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingAttempt) {
    return json({ attempt_id: existingAttempt.id, status: existingAttempt.status, message: "Tentative déjà enregistrée, en attente de confirmation." });
  }

  const { count: attemptCount } = await asService.from("payment_attempts").select("id", { count: "exact", head: true }).eq("payment_id", payment.id);
  if ((attemptCount ?? 0) >= MAX_ATTEMPTS_PER_TICKET) return json({ error: "too_many_attempts" }, 429);

  const { data: attempt, error: attemptError } = await asService
    .from("payment_attempts")
    .insert({ payment_id: payment.id, idempotency_key: idempotencyKey, provider, phone_number: phoneNumber })
    .select("id")
    .single();
  if (attemptError || !attempt) {
    console.error("event-checkout-initiate: création de la tentative échouée", attemptError);
    return json({ error: "internal_error" }, 500);
  }

  try {
    const result = await collect({
      amount: event.price,
      phoneNumber,
      externalReference: attempt.id,
      description: `CampusMarket billet ${eventId.slice(0, 8)}`,
    });
    await asService.from("payment_attempts").update({ provider_reference: result.reference }).eq("id", attempt.id);
    return json({ attempt_id: attempt.id, status: "pending", provider_reference: result.reference, message: "Confirmez le paiement sur votre téléphone." });
  } catch (err) {
    console.error("event-checkout-initiate: appel CamPay échoué", err);
    await asService.from("payment_attempts").update({ status: "failed", failure_reason: String(err) }).eq("id", attempt.id);
    return json({ error: "provider_error" }, 502);
  }
});
