// =============================================================================
// phone-otp-verify — vérifie le code envoyé par phone-otp-request et, en cas
// de succès, marque profile_private.phone / phone_verified. Comparaison de
// hash uniquement : le code en clair ne transite jamais après son envoi (e-mail ou SMS).
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";

const PHONE_REGEX = /^\+237[26]\d{8}$/;
const CODE_REGEX = /^\d{6}$/;

async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
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

  let body: { phone_number?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const phoneNumber = body.phone_number;
  const code = body.code;

  if (!phoneNumber || !PHONE_REGEX.test(phoneNumber)) return json({ error: "invalid_phone_number" }, 400);
  if (!code || !CODE_REGEX.test(code)) return json({ error: "invalid_code_format" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const asService = createClient(supabaseUrl, serviceRoleKey);

  const { data: authData, error: authError } = await asUser.auth.getUser();
  if (authError || !authData.user) return json({ error: "unauthorized" }, 401);
  const userId = authData.user.id;

  // Vérification ATOMIQUE en base (verify_phone_otp, 0021) : verrou de ligne, essai compté AVANT la
  // comparaison, dans la même transaction. Avant, lecture -> comparaison -> incrément laissait N
  // requêtes parallèles lire toutes attempts = 0 et contourner max_attempts.
  const submittedHash = await hashCode(code);
  const { data: result, error: rpcError } = await asService.rpc("verify_phone_otp", {
    p_user_id: userId,
    p_phone: phoneNumber,
    p_code_hash: submittedHash,
  });

  if (rpcError || !result) {
    console.error("phone-otp-verify: vérification échouée", rpcError);
    return json({ error: "internal_error" }, 500);
  }

  switch (result.status) {
    case "verified":
      return json({ message: "Numéro vérifié" });
    case "no_active_code":
      return json({ error: "no_active_code" }, 404);
    case "code_expired":
      return json({ error: "code_expired" }, 410);
    case "too_many_attempts":
      return json({ error: "too_many_attempts" }, 429);
    case "invalid_code":
      return json({ error: "invalid_code", attempts_remaining: result.attempts_remaining }, 400);
    case "phone_already_used":
      return json({ error: "phone_already_used" }, 409);
    default:
      console.error("phone-otp-verify: statut inattendu", result.status);
      return json({ error: "internal_error" }, 500);
  }
});
