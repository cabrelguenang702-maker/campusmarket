/* Achats groupés : types d'affichage et calculs purs (aucun accès réseau ici). */

export type GroupBuyStatus = "actif" | "complet" | "expire";
export type GroupBuyTier = { qty: number; price: number };

export type GroupBuy = {
  id: string;
  productId: string;
  target: number;
  joined: number;
  endsAt: string;
  status: GroupBuyStatus;
  tiers: GroupBuyTier[];
  /** Prix final figé quand l'objectif est atteint (palier atteint, identique pour tous) ; null tant que le groupe est actif. */
  finalPrice: number | null;
};

type Row = { status: "active" | "reached" | "expired" | "cancelled"; ends_at: string };

/** Statut affiché : un groupe « actif » dont l'échéance est passée est considéré expiré, même si la base ne l'a pas encore clôturé. */
export function displayStatus(row: Row, now = Date.now()): GroupBuyStatus | "annule" {
  if (row.status === "cancelled") return "annule";
  if (row.status === "reached") return "complet";
  if (row.status === "expired") return "expire";
  return new Date(row.ends_at).getTime() <= now ? "expire" : "actif";
}

/** Palier atteint et prix courant : le plus haut palier dont le nombre de participants est atteint, sinon le prix de l'annonce. */
export function currentTier(group: Pick<GroupBuy, "joined" | "tiers">, basePrice: number) {
  const reached = [...group.tiers].sort((a, b) => a.qty - b.qty).reverse().find((t) => group.joined >= t.qty);
  return { price: reached?.price ?? basePrice, tier: reached };
}

export const nextTier = (group: Pick<GroupBuy, "joined" | "tiers">) => [...group.tiers].sort((a, b) => a.qty - b.qty).find((t) => group.joined < t.qty);

export const savingPercent = (price: number, base: number) => (base > 0 ? Math.max(0, Math.round((1 - price / base) * 100)) : 0);

/** « 2 j 4 h », « 5 h 10 », « 12 min » ; « Terminé » une fois l'échéance passée. */
export function timeLeft(endsAt: string, now = Date.now()): string {
  const ms = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "Terminé";
  const min = Math.floor(ms / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return h > 0 ? `${d} j ${h} h` : `${d} j`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")}`;
  return `${Math.max(1, m)} min`;
}

/** Participation de la personne connectée : « committed » = engagée, à payer avant l'échéance ; « paid » = payée. */
export type MyParticipation = { status: "committed" | "paid" | "withdrawn" | "expired"; unitPrice: number | null; payDeadline: string | null };

/** « 14 oct. à 18:30 » : échéance de paiement lisible. */
export const formatDeadline = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
};
