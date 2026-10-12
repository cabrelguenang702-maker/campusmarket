// =============================================================================
// course-checkout-initiate — équivalent de payments-initiate (0007) mais pour
// une inscription à une formation payante plutôt qu'une commande marketplace.
// Réutilise le même client CamPay ; voir payments-initiate pour les
// commentaires détaillés sur chaque garde-fou, non répétés ici.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { collect, detectOperator } from "../_shared/campay.ts";

const MAX_ATTEMPTS_PER_ENROLLMENT = 5;
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

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  let body: { course_id?: string; phone_number?: string; idempotency_key?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { course_id: courseId, phone_number: phoneNumber, idempotency_key: idempotencyKey } = body;

  if (!courseId || !UUID_REGEX.test(courseId)) return json({ error: "invalid_course_id" }, 400);
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

  const { data: course, error: courseError } = await asUser
    .from("courses")
    .select("id, price, status")
    .eq("id", courseId)
    .eq("status", "published")
    .single();

  if (courseError || !course) return json({ error: "course_not_found" }, 404);
  if (course.price === 0) return json({ error: "course_is_free", message: "Inscrivez-vous directement, aucun paiement requis" }, 409);

  // Récupère ou crée l'inscription en pending_payment pour cet utilisateur+cours
  // (contrainte unique (course_id, user_id) : une seule inscription par paire).
  let { data: enrollment } = await asService
    .from("course_enrollments")
    .select("id, status")
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!enrollment) {
    const { data: newEnrollment, error: createError } = await asService
      .from("course_enrollments")
      .insert({ course_id: courseId, user_id: userId, unit_price: course.price, idempotency_key: idempotencyKey, status: "pending_payment" })
      .select("id, status")
      .single();
    if (createError || !newEnrollment) {
      console.error("course-checkout-initiate: création enrollment échouée", createError);
      return json({ error: "internal_error" }, 500);
    }
    enrollment = newEnrollment;
  }

  if (enrollment.status === "active") return json({ error: "already_enrolled" }, 409);
  if (enrollment.status === "refunded") return json({ error: "enrollment_refunded" }, 409);
  if (enrollment.status === "cancelled") {
    // Une inscription annulée (abandon de paiement précédent) peut être
    // relancée : on la repasse en pending_payment plutôt que d'en créer une
    // seconde (la contrainte unique (course_id, user_id) l'interdirait de toute façon).
    await asService.from("course_enrollments").update({ status: "pending_payment" }).eq("id", enrollment.id);
  }

  let { data: payment } = await asService
    .from("payments")
    .select("id, status")
    .eq("course_enrollment_id", enrollment.id)
    .maybeSingle();

  if (!payment) {
    const { data: newPayment, error: createPaymentError } = await asService
      .from("payments")
      .insert({ course_enrollment_id: enrollment.id, amount: course.price, currency: "XAF" })
      .select("id, status")
      .single();
    if (createPaymentError || !newPayment) {
      console.error("course-checkout-initiate: création payment échouée", createPaymentError);
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

  const { count: attemptCount } = await asService
    .from("payment_attempts")
    .select("id", { count: "exact", head: true })
    .eq("payment_id", payment.id);

  if ((attemptCount ?? 0) >= MAX_ATTEMPTS_PER_ENROLLMENT) return json({ error: "too_many_attempts" }, 429);

  const { data: attempt, error: attemptError } = await asService
    .from("payment_attempts")
    .insert({ payment_id: payment.id, idempotency_key: idempotencyKey, provider, phone_number: phoneNumber })
    .select("id")
    .single();

  if (attemptError || !attempt) {
    console.error("course-checkout-initiate: création attempt échouée", attemptError);
    return json({ error: "internal_error" }, 500);
  }

  try {
    const result = await collect({
      amount: course.price,
      phoneNumber,
      externalReference: attempt.id,
      description: `CampusMarket formation ${courseId.slice(0, 8)}`,
    });

    await asService.from("payment_attempts").update({ provider_reference: result.reference }).eq("id", attempt.id);

    return json({ attempt_id: attempt.id, status: "pending", provider_reference: result.reference, message: "Confirmez le paiement sur votre téléphone." });
  } catch (err) {
    console.error("course-checkout-initiate: appel CamPay échoué", err);
    await asService.from("payment_attempts").update({ status: "failed", failure_reason: String(err) }).eq("id", attempt.id);
    return json({ error: "provider_error" }, 502);
  }
});
