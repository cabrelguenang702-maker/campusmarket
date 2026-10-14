import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase, requireSupabase } from "../supabase";
import { invokeFunction } from "./functions";

/* Paiement Mobile Money (CamPay) : une demande de paiement est envoyée au téléphone de l'acheteur par une Edge Function,
 * puis le webhook CamPay ou le rapprochement planifié règle la tentative. Le client ne fait que lancer et observer :
 * le montant vient toujours de la base, jamais de l'écran. */

export type PaymentState = "choix" | "mobile" | "attente" | "confirme" | "echec" | "expire";
export type PaymentMethod = "mtn" | "orange";
export type PaymentKind = "order" | "course" | "event" | "unblock";

/** Même table de préfixes que supabase/functions/_shared/campay.ts. */
export function operatorOf(nationalNumber: string): PaymentMethod | null {
  const d = nationalNumber.replace(/\D/g, "");
  const p2 = d.slice(0, 2);
  const p3 = d.slice(0, 3);
  if (p2 === "67" || p2 === "68" || ["650", "651", "652", "653", "654"].includes(p3)) return "mtn";
  if (p2 === "69" || ["655", "656", "657", "658", "659"].includes(p3)) return "orange";
  return null;
}

/** Numéro national (9 chiffres, sans indicatif) à partir de la saisie ; null si invalide. */
export function nationalNumber(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (d.startsWith("237") && d.length === 12) d = d.slice(3);
  return /^[26]\d{8}$/.test(d) ? d : null;
}

const ERRORS: Record<string, string> = {
  invalid_phone_number: "Numéro invalide. Saisissez 9 chiffres commençant par 6 (ex. 6 77 12 34 56).",
  unsupported_operator: "Ce numéro n'est pas un compte MTN Mobile Money ou Orange Money.",
  order_not_found: "Commande introuvable.",
  order_not_payable: "Cette commande ne peut plus être payée (annulée ou déjà réglée).",
  already_paid: "Cette commande est déjà payée.",
  already_enrolled: "Vous êtes déjà inscrit à cette formation.",
  already_registered: "Vous avez déjà un billet pour cet événement.",
  event_not_found: "Événement introuvable ou non publié.",
  event_ended: "Cet événement est terminé : les inscriptions sont closes.",
  sold_out: "Il n'y a plus de place pour cet événement.",
  not_blocked: "Vous n'êtes pas bloqué : vous pouvez rejoindre un achat groupé.",
  account_not_active: "Votre compte ne permet pas cette action pour le moment.",
  too_many_attempts: "Trop de tentatives pour cette commande. Contactez le support.",
  provider_error: "L'opérateur n'a pas répondu. Aucun montant n'a été débité, réessayez dans un instant.",
  unauthorized: "Votre session a expiré. Reconnectez-vous.",
  internal_error: "Une erreur est survenue de notre côté. Réessayez dans un instant.",
};

type AttemptRow = { id: string; status: string; failure_reason: string | null };

const POLL_MS = 3000;
const MAX_WAIT_MS = 5 * 60 * 1000;

export type PaymentProcess = {
  state: PaymentState;
  setState: (s: PaymentState) => void;
  busy: boolean;
  error: string | null;
  attemptId: string | null;
  /** Lance la demande de paiement ; le numéro est la saisie brute (avec ou sans indicatif). */
  pay: (phone: string, method: PaymentMethod) => Promise<void>;
  /** Relit l'état de la tentative maintenant (bouton « J'ai validé »). */
  check: () => Promise<void>;
  reset: () => void;
};

export function usePaymentProcess(opts: { kind: PaymentKind; targetId: string | undefined; onConfirmed?: () => void }): PaymentProcess {
  const { kind, targetId } = opts;
  const [state, setState] = useState<PaymentState>("choix");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const startedAt = useRef(0);
  const confirmedRef = useRef(opts.onConfirmed);
  confirmedRef.current = opts.onConfirmed;

  const apply = useCallback((status: string) => {
    if (status === "success") { setState("confirme"); confirmedRef.current?.(); return true; }
    if (status === "failed") { setState("echec"); return true; }
    if (status === "expired" || status === "cancelled") { setState("expire"); return true; }
    return false;
  }, []);

  const check = useCallback(async () => {
    if (!attemptId || getSupabase() === null) return;
    const { data, error: e } = await requireSupabase().from("payment_attempts").select("id, status, failure_reason").eq("id", attemptId).maybeSingle();
    if (e || !data) return;
    const done = apply((data as AttemptRow).status);
    if (!done && Date.now() - startedAt.current > MAX_WAIT_MS) setState("expire");
  }, [attemptId, apply]);

  useEffect(() => {
    if (state !== "attente" || !attemptId) return;
    const t = setInterval(() => { void check(); }, POLL_MS);
    return () => clearInterval(t);
  }, [state, attemptId, check]);

  const pay = useCallback(async (phone: string, method: PaymentMethod) => {
    setError(null);
    if (!targetId) { setError("Commande introuvable."); return; }
    const national = nationalNumber(phone);
    if (!national) { setError(ERRORS["invalid_phone_number"]!); return; }
    const detected = operatorOf(national);
    if (!detected) { setError(ERRORS["unsupported_operator"]!); return; }
    if (detected !== method) { setError(`Ce numéro est un compte ${detected === "mtn" ? "MTN Mobile Money" : "Orange Money"}. Choisissez le bon moyen de paiement ou changez de numéro.`); return; }

    // Une même clé couvre les relances réseau d'un même clic ; une nouvelle tentative volontaire en reçoit une nouvelle.
    keyRef.current ??= crypto.randomUUID();
    setBusy(true);
    const key = keyRef.current;
    const phone_number = `+237${national}`;
    const [fn, body] = kind === "order" ? ["payments-initiate", { order_id: targetId, phone_number, idempotency_key: key }]
      : kind === "course" ? ["course-checkout-initiate", { course_id: targetId, phone_number, idempotency_key: key }]
      : kind === "unblock" ? ["group-unblock-initiate", { phone_number, idempotency_key: key }]
      : ["event-checkout-initiate", { event_id: targetId, phone_number, idempotency_key: key }];
    const res = await invokeFunction<{ attempt_id: string; status: string }>(fn, body);
    setBusy(false);

    if (res.ok) {
      keyRef.current = null;
      setAttemptId(res.data.attempt_id);
      startedAt.current = Date.now();
      if (!apply(res.data.status)) setState("attente");
      return;
    }
    if (res.kind === "network") { setError("Connexion impossible. Vérifiez votre réseau puis réessayez : vous ne serez pas débité deux fois."); return; }
    if (res.kind === "not_configured") { setError("Le paiement n'est pas configuré."); return; }
    keyRef.current = null;
    if (res.code === "already_paid" || res.code === "already_enrolled" || res.code === "already_registered") { setState("confirme"); confirmedRef.current?.(); return; }
    setError(ERRORS[res.code] ?? "Le paiement n'a pas pu être lancé. Réessayez dans un instant.");
  }, [kind, targetId, apply]);

  const reset = useCallback(() => { setState("choix"); setError(null); setAttemptId(null); keyRef.current = null; }, []);

  return { state, setState, busy, error, attemptId, pay, check, reset };
}
