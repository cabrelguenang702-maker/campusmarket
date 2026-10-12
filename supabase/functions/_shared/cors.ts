// En production, ALLOWED_ORIGIN doit valoir l'origine EXACTE de l'application
// (ex. "https://campusmarket.example"). Sans elle on retombe sur "*" : pratique en
// développement, signalé par le contrôle de pré-production (supabase/PRODUCTION.md).
// Les jetons voyagent en en-tête Authorization (jamais en cookie), donc "*" n'ouvre pas
// de CSRF, mais une origine fixe évite qu'un site tiers pilote l'API avec un jeton volé.
const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

export const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
