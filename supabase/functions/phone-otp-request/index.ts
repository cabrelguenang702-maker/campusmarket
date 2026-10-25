// =============================================================================
// phone-otp-request — génère et envoie un code de vérification à 6 chiffres
// pour un numéro camerounais. Réf. Backend_Hardened section 9 ("OTP à usage
// unique, expiration courte, nombre de tentatives limité") et section 24
// ("les logs ne doivent pas contenir... OTP").
//
// Livraison du code (variable OTP_DELIVERY) :
//   "email" (défaut) : le code est envoyé à l'adresse e-mail du compte, via _shared/email.ts
//                      (EMAIL_PROVIDER / EMAIL_API_KEY / EMAIL_FROM). Solution de départ sans SMS.
//                      ATTENTION : cela prouve l'accès à la boîte e-mail, PAS la possession du
//                      numéro de téléphone saisi.
//   "sms"            : envoi par SMS via _shared/sms.ts (aucun prestataire branché pour l'instant).
//
// Le code n'est JAMAIS stocké en clair (seul son hash SHA-256), jamais loggé,
// et n'apparaît dans aucune réponse HTTP.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/email.ts";
import { sendSms } from "../_shared/sms.ts";

const PHONE_REGEX = /^\+237[26]\d{8}$/;
const CODE_TTL_MINUTES = 10;
const DELIVERY = (Deno.env.get("OTP_DELIVERY") ?? "email").toLowerCase();

/** "camille@gmail.com" -> "ca***@gmail.com" : affiché à l'utilisateur sans exposer l'adresse entière. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateCode(): string {
  // 6 chiffres, source cryptographiquement sûre (pas Math.random()).
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

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

  let body: { phone_number?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const phoneNumber = body.phone_number;
  if (!phoneNumber || !PHONE_REGEX.test(phoneNumber)) {
    return json({ error: "invalid_phone_number" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const asService = createClient(supabaseUrl, serviceRoleKey);

  const { data: authData, error: authError } = await asUser.auth.getUser();
  if (authError || !authData.user) return json({ error: "unauthorized" }, 401);
  const userId = authData.user.id;
  const userEmail = authData.user.email ?? null;

  if (DELIVERY === "email" && !userEmail) return json({ error: "no_email_on_account" }, 422);

  const code = generateCode();
  const codeHash = await hashCode(code);

  // Limites (par utilisateur ET par numéro : sans la seconde, créer des comptes suffisait pour
  // harceler un numéro par SMS ou faire exploser la facture) et insertion sont faites
  // atomiquement en base, sous verrou consultatif — voir create_phone_otp (0021).
  const { data: created, error: createError } = await asService.rpc("create_phone_otp", {
    p_user_id: userId,
    p_phone: phoneNumber,
    p_code_hash: codeHash,
    p_expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
  });

  if (createError || !created) {
    console.error("phone-otp-request: création du code échouée", createError);
    return json({ error: "internal_error" }, 500);
  }
  if (created.status === "too_many_requests") {
    return json({ error: "too_many_requests" }, 429);
  }
  const row = { id: created.id as string };

  try {
    if (DELIVERY === "sms") {
      await sendSms(phoneNumber, `CampusMarket : votre code de vérification est ${code}. Valable ${CODE_TTL_MINUTES} minutes.`);
    } else {
      await sendEmail(
        userEmail!,
        "Votre code de vérification CampusMarket",
        `Bonjour,\n\nVotre code de vérification CampusMarket est : ${code}\n\n` +
          `Il sert à vérifier le numéro se terminant par ${phoneNumber.slice(-4)} et reste valable ${CODE_TTL_MINUTES} minutes.\n` +
          `Ne le communiquez à personne. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\n` +
          `L'équipe CampusMarket`,
      );
    }
  } catch (err) {
    console.error("phone-otp-request: envoi du code échoué", err);
    // On retire le code non délivré plutôt que de laisser une ligne
    // invérifiable consommer le quota anti-abus de l'utilisateur.
    await asService.from("phone_verification_codes").delete().eq("id", row.id);
    return json({ error: "delivery_error" }, 502);
  }

  await asService.from("security_logs").insert({
    user_id: userId,
    event_type: "otp_requested",
    metadata: { phone_last4: phoneNumber.slice(-4), delivery: DELIVERY },
  });

  return json({
    message: "Code envoyé",
    expires_in_seconds: CODE_TTL_MINUTES * 60,
    delivery: DELIVERY === "sms" ? "sms" : "email",
    sent_to: DELIVERY === "sms" ? null : maskEmail(userEmail!),
  });
});
