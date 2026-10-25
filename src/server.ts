import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// En-têtes de sécurité, posés sur TOUTE réponse (SSR, pages d'erreur, assets servis par
// le même worker). Réf. Backend_Hardened section 36.
//
// CSP : script-src garde 'unsafe-inline' parce que l'hydratation SSR de TanStack Start et le
// script d'initialisation du thème (src/lib/theme.tsx) sont des scripts inline. Le gain vient
// donc des autres directives : connect-src limite où le code peut envoyer des données (une
// XSS ne peut plus exfiltrer vers un domaine quelconque), object-src/base-uri/form-action/
// frame-ancestors ferment les vecteurs classiques. Pour passer à une CSP à nonces, il faut
// que le serveur injecte le nonce dans les scripts d'hydratation — chantier séparé.
//
// SUPABASE_URL (variable d'environnement du worker) restreint connect-src/img-src à TON projet ;
// absente, on retombe sur *.supabase.co (développement).
// -----------------------------------------------------------------------------
function securityHeaders(env: unknown): Record<string, string> {
  const e = (env ?? {}) as { SUPABASE_URL?: string };
  // Même URL que celle du client web (VITE_SUPABASE_URL, injectée au build) : une seule valeur à configurer.
  // SUPABASE_URL (variable du worker) reste prioritaire si elle est définie.
  const configured = e.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
  let supabaseOrigin = "https://*.supabase.co";
  let supabaseWs = "wss://*.supabase.co";
  try {
    if (configured) {
      const u = new URL(configured);
      supabaseOrigin = u.origin;
      supabaseWs = `wss://${u.host}`;
    }
  } catch {
    /* URL invalide : on garde le repli */
  }

  // OneSignal (VITE_PUSH_PROVIDER=onesignal) charge son SDK depuis cdn.onesignal.com et parle à *.onesignal.com :
  // ces origines ne sont ouvertes que dans ce cas. Le Web Push natif n'a besoin d'aucune ouverture.
  const oneSignal = import.meta.env.VITE_PUSH_PROVIDER === "onesignal";
  const osScript = oneSignal ? " https://cdn.onesignal.com" : "";
  const osNet = oneSignal ? " https://onesignal.com https://*.onesignal.com" : "";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${osScript}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src 'self' data: blob: ${supabaseOrigin}${osNet}`,
    `media-src 'self' blob: ${supabaseOrigin}`,
    `connect-src 'self' ${supabaseOrigin} ${supabaseWs}${osNet}`,
    ...(oneSignal ? [`frame-src 'self'${osNet}`] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  return {
    "Content-Security-Policy": csp,
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

function withSecurityHeaders(response: Response, env: unknown): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders(env))) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response), env);
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        env,
      );
    }
  },
};
