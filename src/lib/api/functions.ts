import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";
import { requireSupabase } from "../supabase";

export type FunctionResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "http"; status: number; code: string; body: Record<string, unknown> }
  | { ok: false; kind: "network" }
  | { ok: false; kind: "not_configured" };

/**
 * Appelle une Edge Function avec le jeton de l'utilisateur connecté (ajouté par le client).
 * Les fonctions du projet répondent `{ error: "<code>" }` avec un statut HTTP : on les expose telles
 * quelles (code + statut) pour que chaque écran traduise lui-même en message.
 */
export async function invokeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>,
): Promise<FunctionResult<T>> {
  let sb;
  try {
    sb = requireSupabase();
  } catch {
    return { ok: false, kind: "not_configured" };
  }

  const { data, error } = await sb.functions.invoke(name, { body });
  if (!error) return { ok: true, data: data as T };

  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    let code = "unknown";
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
      if (typeof body["error"] === "string") code = body["error"];
    } catch {
      /* corps non JSON : on garde « unknown » */
    }
    return { ok: false, kind: "http", status: response.status, code, body };
  }
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError)
    return { ok: false, kind: "network" };
  return { ok: false, kind: "network" };
}
