import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { collect, detectOperator } from "../_shared/campay.ts";

// tutoring-checkout-initiate — paiement d'une séance de tutorat acceptée par Mobile Money.
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

  let body: { request_id?: string; phone_number?: string; idempotency_key?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { request_id: requestId, phone_number: phoneNumber, idempotency_key: idempotencyKey } = body;
  if (!idempotencyKey || !UUID_REGEX.test(idempotencyKey)) return json({ error: "invalid_idempotency_key" }, 400);
  if (!requestId || !UUID_REGEX.test(requestId)) return json({ error: "invalid_request" }, 400);
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

  const { data: target, error: targetError } = await asService.rpc("create_tutoring_payment_target", { p_user: userId, p_request: requestId });
  if (targetError || !target) {
    console.error("tutoring-checkout-initiate: vérification échouée", targetError);
    return json({ error: "internal_error" }, 500);
  }
  if (!target.success) return json({ error: target.error }, target.error === "request_not_found" ? 404 : 409);
  const amount = Number(target.amount);
  if (!Number.isInteger(amount) || amount <= 0) return json({ error: "internal_error" }, 500);

  let { data: payment } = await asService.from("payments").select("id, status").eq("tutoring_request_id", requestId).maybeSingle();
  if (!payment) {
    const { data: newPayment, error: createPaymentError } = await asService.from("payments").insert({ tutoring_request_id: requestId, amount, currency: "XAF" }).select("id, status").single();
    if (createPaymentError || !newPayment) {
      console.error("tutoring-checkout-initiate: création du paiement échouée", createPaymentError);
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
    console.error("tutoring-checkout-initiate: création de la tentative échouée", attemptError);
    return json({ error: "internal_error" }, 500);
  }

  try {
    const result = await collect({ amount, phoneNumber, externalReference: attempt.id, description: "CampusMarket tutorat" });
    await asService.from("payment_attempts").update({ provider_reference: result.reference }).eq("id", attempt.id);
    return json({ attempt_id: attempt.id, status: "pending", provider_reference: result.reference, message: "Confirmez le paiement sur votre téléphone." });
  } catch (err) {
    console.error("tutoring-checkout-initiate: appel CamPay échoué", err);
    await asService.from("payment_attempts").update({ status: "failed", failure_reason: String(err) }).eq("id", attempt.id);
    return json({ error: "provider_error" }, 502);
  }
});
