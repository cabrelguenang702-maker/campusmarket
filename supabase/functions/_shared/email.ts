// -----------------------------------------------------------------------------
// Envoi d'e-mail transactionnel — trois prestataires REST au choix via la
// variable EMAIL_PROVIDER : "resend" | "brevo" | "mailgun". Les formats de
// requête ont été vérifiés dans la documentation de chacun (endpoint, en-têtes
// d'authentification, forme du corps).
//
//   resend   POST https://api.resend.com/emails            Authorization: Bearer <clé>
//   brevo    POST https://api.brevo.com/v3/smtp/email       api-key: <clé>
//   mailgun  POST https://api.mailgun.net/v3/<domaine>/messages   Basic api:<clé>
//            (région UE : https://api.eu.mailgun.net)
//
// Variables communes : EMAIL_PROVIDER, EMAIL_API_KEY, EMAIL_FROM
//   EMAIL_FROM = adresse d'expédition DÉJÀ VÉRIFIÉE chez le prestataire, au format
//   "CampusMarket <notifications@votre-domaine.com>" ou "notifications@votre-domaine.com".
//   Un domaine non vérifié est la cause n°1 d'échec à la mise en route.
// Spécifique Mailgun : MAILGUN_DOMAIN (obligatoire), MAILGUN_REGION ("eu" ou "us", défaut us).
//
// Tout est échec EXPLICITE : configuration absente ou incomplète -> exception
// lisible, jamais un envoi silencieusement perdu.
//
// Erreurs `permanent` (clé invalide, expéditeur non vérifié, destinataire refusé :
// 4xx hors 429) : inutile de réessayer, la file les marque 'failed' tout de suite.
// Erreurs transitoires (429, 5xx, réseau, délai dépassé) : la file réessaie.
// -----------------------------------------------------------------------------

export class EmailError extends Error {
  permanent: boolean;
  constructor(message: string, permanent: boolean) {
    super(message);
    this.name = "EmailError";
    this.permanent = permanent;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new EmailError(`Variable d'environnement ${name} absente (voir functions/.env.example)`, true);
  }
  return value;
}

/** "Nom <a@b.c>" -> { name, email } ; "a@b.c" -> { email }. */
export function parseSender(from: string): { name?: string; email: string } {
  const match = from.match(/^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (match) {
    const name = match[1].replace(/^"|"$/g, "").trim();
    return name ? { name, email: match[2] } : { email: match[2] };
  }
  return { email: from.trim() };
}

async function post(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Réseau coupé, DNS, délai dépassé : transitoire.
    throw new EmailError(`${provider}: appel impossible (${String(err)})`, false);
  }

  if (res.ok) return;

  const detail = (await res.text().catch(() => "")).slice(0, 300);
  // 429 = quota momentané, 5xx = panne côté prestataire : on réessaiera.
  // Les autres 4xx (401 clé invalide, 403, 422 expéditeur non vérifié...) ne
  // se corrigeront pas d'eux-mêmes.
  const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
  throw new EmailError(`${provider}: HTTP ${res.status} ${detail}`, permanent);
}

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const provider = (Deno.env.get("EMAIL_PROVIDER") ?? "").toLowerCase();

  if (!provider) {
    throw new EmailError(
      "Aucun prestataire e-mail configuré (variable EMAIL_PROVIDER absente). " +
        'Valeurs possibles : "resend", "brevo", "mailgun" — voir functions/.env.example.',
      true,
    );
  }

  const apiKey = requireEnv("EMAIL_API_KEY");
  const from = requireEnv("EMAIL_FROM");

  switch (provider) {
    case "resend":
      return post(
        "Resend",
        "https://api.resend.com/emails",
        { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        JSON.stringify({ from, to: [to], subject, text }),
      );

    case "brevo":
      return post(
        "Brevo",
        "https://api.brevo.com/v3/smtp/email",
        { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
        JSON.stringify({ sender: parseSender(from), to: [{ email: to }], subject, textContent: text }),
      );

    case "mailgun": {
      const domain = requireEnv("MAILGUN_DOMAIN");
      const base = (Deno.env.get("MAILGUN_REGION") ?? "us").toLowerCase() === "eu"
        ? "https://api.eu.mailgun.net"
        : "https://api.mailgun.net";
      return post(
        "Mailgun",
        `${base}/v3/${domain}/messages`,
        {
          Authorization: `Basic ${btoa(`api:${apiKey}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        new URLSearchParams({ from, to, subject, text }).toString(),
      );
    }

    default:
      throw new EmailError(
        `EMAIL_PROVIDER "${provider}" inconnu. Valeurs possibles : "resend", "brevo", "mailgun".`,
        true,
      );
  }
}
