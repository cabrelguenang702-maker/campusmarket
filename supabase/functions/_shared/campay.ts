// -----------------------------------------------------------------------------
// Client CamPay minimal — agrégateur utilisé pour appeler MTN Mobile Money et
// Orange Money au Cameroun via une seule intégration.
//
// Réf. API CamPay (documentation publique Postman du prestataire) :
//   POST /api/token/                      -> { token }
//   POST /api/collect/                    -> { reference }
//   GET  /api/transaction/{reference}/    -> { status, amount, operator, ... }
//
// Signature du webhook (confirmé via le SDK Go officiel, NdoleStudio/campay-go-sdk
// v0.0.16, client.go — ValidateCallback) : le champ "signature" du callback n'est
// PAS un HMAC brut à comparer, c'est un JWT signé avec la clé webhook comme
// secret HMAC (jwt.Parse(signature, webhookKey)). verifyWebhookSignature()
// ci-dessous reproduit exactement cette vérification (HS256 uniquement).
// Même vérifiée, cette signature reste une défense secondaire : payments-webhook
// reconfirme TOUJOURS le statut via getTransactionStatus() avant de valider quoi
// que ce soit (section 47).
// -----------------------------------------------------------------------------

const CAMPAY_BASE_URL = Deno.env.get("CAMPAY_BASE_URL") ?? "https://api.campay.net";

export type CampayTransactionStatus = "PENDING" | "SUCCESSFUL" | "FAILED";

export interface CampayCollectResult {
  reference: string;
}

export interface CampayTransactionStatusResult {
  reference: string;
  status: CampayTransactionStatus;
  amount: string;
  currency: string;
  operator: string | null;
  operator_reference: string | null;
  code: string | null;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  // Le token CamPay est de courte durée : on le met en cache pour la durée de
  // vie de l'instance de la fonction (pas de persistance inter-invocations
  // nécessaire ici), avec une marge de 30s avant expiration réelle.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  const username = Deno.env.get("CAMPAY_APP_USERNAME");
  const password = Deno.env.get("CAMPAY_APP_PASSWORD");
  if (!username || !password) {
    throw new Error("CAMPAY_APP_USERNAME / CAMPAY_APP_PASSWORD manquants");
  }

  const res = await fetch(`${CAMPAY_BASE_URL}/api/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    throw new Error(`CamPay token: échec HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!data.token) {
    throw new Error("CamPay token: réponse sans champ token");
  }

  // CamPay ne documente pas publiquement la durée de vie exacte du token ;
  // 50 minutes est une marge prudente pour un usage type "un appel = un token".
  cachedToken = { token: data.token, expiresAt: Date.now() + 50 * 60_000 };
  return data.token;
}

/**
 * Déclenche une demande de paiement (l'utilisateur reçoit une invite USSD/app
 * sur son téléphone pour valider). Ne renvoie PAS un paiement confirmé — juste
 * une référence à suivre via getTransactionStatus ou le webhook.
 */
export async function collect(params: {
  amount: number;
  phoneNumber: string; // format +237XXXXXXXXX
  externalReference: string; // notre payment_attempts.id, pour retrouver l'appel côté CamPay
  description: string;
}): Promise<CampayCollectResult> {
  const token = await getToken();

  const res = await fetch(`${CAMPAY_BASE_URL}/api/collect/`, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: String(params.amount),
      currency: "XAF",
      from: params.phoneNumber.replace("+", ""),
      description: params.description,
      external_reference: params.externalReference,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.reference) {
    throw new Error(`CamPay collect: échec (HTTP ${res.status}) — ${JSON.stringify(data)}`);
  }

  return { reference: data.reference };
}

/**
 * Reconfirme l'état d'une transaction directement auprès de CamPay plutôt que
 * de se fier au corps d'un webhook — appelée par payments-webhook avant tout
 * changement de statut, et par payments-reconcile pour les tentatives restées
 * pending trop longtemps (section 47, "réconciliation périodique").
 */
export async function getTransactionStatus(
  reference: string,
): Promise<CampayTransactionStatusResult> {
  const token = await getToken();

  const res = await fetch(`${CAMPAY_BASE_URL}/api/transaction/${reference}/`, {
    method: "GET",
    headers: { Authorization: `Token ${token}` },
  });

  if (!res.ok) {
    throw new Error(`CamPay transaction status: échec HTTP ${res.status}`);
  }

  return await res.json();
}

/**
 * Détecte l'opérateur à partir du préfixe du numéro camerounais (+237).
 * Plages confirmées (agrégateur DusuPay, cohérent avec l'allocation ART) :
 * MTN Mobile Money : 67, 68, 650-654 ; Orange Money : 69, 655-659.
 */
export function detectOperator(phoneNumber: string): "mtn_momo" | "orange_money" | null {
  const digits = phoneNumber.replace("+237", "");
  const prefix2 = digits.slice(0, 2);
  const prefix3 = digits.slice(0, 3);

  if (prefix2 === "67" || prefix2 === "68" ||
      ["650", "651", "652", "653", "654"].includes(prefix3)) {
    return "mtn_momo";
  }
  if (prefix2 === "69" || ["655", "656", "657", "658", "659"].includes(prefix3)) {
    return "orange_money";
  }
  return null;
}

// -----------------------------------------------------------------------------
// Vérification de signature webhook — voir le commentaire en tête de fichier.
// Le "signature" envoyé par CamPay est un JWT ; on vérifie qu'il a bien été
// signé en HS256 avec la clé webhook, sans se fier aux claims qu'il contient
// (CamPay ne documente pas leur contenu ; seule la validité de la signature
// compte, exactement comme jwt.Parse côté SDK Go officiel).
// -----------------------------------------------------------------------------
function base64UrlToBytes(base64Url: string): Uint8Array {
  const padded = base64Url.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function verifyWebhookSignature(
  signatureJwt: string,
  webhookKey: string,
): Promise<boolean> {
  const parts = signatureJwt.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64)));
  } catch {
    return false;
  }

  // Seul HS256 (HMAC symétrique) a du sens pour une clé webhook partagée ;
  // tout autre algorithme (ou "none") est rejeté par prudence.
  if (header.alg !== "HS256") {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  try {
    return await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signatureB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
  } catch {
    return false;
  }
}
