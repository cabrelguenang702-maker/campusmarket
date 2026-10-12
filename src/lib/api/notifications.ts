import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { timeAgo } from "../domain";

/* Notifications. La base stocke un type, une cible et un petit payload ; le texte affiché est composé ici. */

export type NotifCategory = "produit" | "message" | "achat" | "groupe" | "evenement" | "formation" | "systeme" | "securite";
export const notifCategories: NotifCategory[] = ["produit", "message", "achat", "groupe", "evenement", "formation", "systeme", "securite"];

export type AppNotification = {
  id: string;
  category: NotifCategory;
  type: string;
  title: string;
  body: string;
  to: string;
  time: string;
  group: "aujourdhui" | "hier" | "avant";
  unread: boolean;
  createdAt: string;
};

type Row = {
  id: string; category: NotifCategory; type: string; target_type: string | null; target_id: string | null; payload: Record<string, unknown> | null;
  read_at: string | null; created_at: string; actor: { full_name: string } | { full_name: string }[] | null;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Texte et destination d'une notification, d'après son type. Un type inconnu reste lisible (repli générique). */
export function describe(r: Pick<Row, "type" | "category" | "target_id" | "payload"> & { actorName?: string | undefined }): { title: string; body: string; to: string } {
  const who = r.actorName ?? "Un membre";
  const id = r.target_id;
  const p = r.payload ?? {};
  switch (r.type) {
    case "new_message": return { title: "Nouveau message", body: `${who} vous a écrit.`, to: id ? `/messages/${id}` : "/messages" };
    case "offer_received": return { title: "Nouvelle offre", body: `${who} vous propose un prix sur votre annonce.`, to: "/profil?onglet=ventes" };
    case "offer_accepted": return { title: "Offre acceptée", body: `${who} a accepté votre offre. Finalisez l'achat pour la réserver.`, to: str(p["product_id"]) ? `/produit/${str(p["product_id"])}/acheter` : "/profil?onglet=achats" };
    case "offer_countered": return { title: "Contre-proposition", body: `${who} vous propose un autre prix.`, to: str(p["product_id"]) ? `/produit/${str(p["product_id"])}` : "/marketplace" };
    case "offer_rejected": return { title: "Offre refusée", body: `${who} a refusé votre offre.`, to: str(p["product_id"]) ? `/produit/${str(p["product_id"])}` : "/marketplace" };
    case "offer_withdrawn": return { title: "Offre retirée", body: `${who} a retiré son offre.`, to: "/profil?onglet=ventes" };
    case "order_received": return { title: "Nouvelle commande", body: `${who} a commandé votre article. Le paiement est en attente.`, to: "/profil?onglet=ventes" };
    case "order_paid": return { title: "Commande payée", body: `${who} a payé. Convenez de la remise de l'article.`, to: "/profil?onglet=ventes" };
    case "payment_confirmed": return { title: "Paiement confirmé", body: "Votre paiement a bien été reçu. Contactez le vendeur pour la remise.", to: "/profil?onglet=achats" };
    case "product_available": return { title: "De nouveau disponible", body: `${str(p["name"]) ?? "Un article"} que vous suiviez est disponible.`, to: id ? `/produit/${id}` : "/marketplace" };
    case "wanted_match": return { title: "Une annonce correspond à votre demande", body: str(p["name"]) ?? "Un vendeur vient de publier un article qui correspond.", to: id ? `/produit/${id}` : "/je-recherche" };
    case "product_removed": return { title: "Annonce retirée", body: "L'une de vos annonces a été retirée par la modération.", to: "/profil?onglet=annonces" };
    case "group_purchase_reached": return { title: "Achat groupé validé", body: "Le seuil est atteint : l'achat groupé est confirmé.", to: "/groupes" };
    case "group_purchase_cancelled": return { title: "Achat groupé annulé", body: "L'achat groupé n'a pas atteint son seuil à temps.", to: "/groupes" };
    case "space_invitation": return { title: "Invitation", body: `${who} vous invite à rejoindre un espace.`, to: "/communautes" };
    case "membership_requested": return { title: "Demande d'adhésion", body: `${who} souhaite rejoindre votre espace.`, to: "/communautes" };
    case "membership_approved": return { title: "Adhésion acceptée", body: "Votre demande d'adhésion a été acceptée.", to: "/communautes" };
    case "membership_rejected": return { title: "Adhésion refusée", body: "Votre demande d'adhésion n'a pas été retenue.", to: "/communautes" };
    case "new_comment": return { title: "Nouveau commentaire", body: `${who} a commenté une publication.`, to: "/communautes" };
    case "ticket_confirmed": return { title: "Billet confirmé", body: "Votre billet est prêt : retrouvez-le dans l'événement.", to: id ? `/evenements/${id}` : "/evenements" };
    case "event_reminder": return { title: "Rappel d'événement", body: "Un événement auquel vous participez approche.", to: id ? `/evenements/${id}` : "/evenements" };
    case "enrollment_confirmed": return { title: "Inscription confirmée", body: "Vous avez accès à votre formation.", to: id ? `/formations/${id}` : "/formations" };
    case "certificate_issued": return { title: "Certificat délivré", body: "Félicitations ! Votre certificat est disponible.", to: id ? `/formations/${id}/certificat` : "/formations" };
    case "verification_approved": return { title: "Compte vérifié", body: "Votre statut d'étudiant a été vérifié.", to: "/profil/verification" };
    case "verification_rejected": return { title: "Vérification refusée", body: "Votre demande de vérification n'a pas été acceptée. Vous pouvez en déposer une nouvelle.", to: "/profil/verification" };
    case "support_reply": return { title: "Réponse du support", body: "Notre équipe a répondu à votre demande.", to: id ? `/aide/${id}` : "/aide?onglet=tickets" };
    case "moderation_warning": return { title: "Avertissement", body: "Un modérateur vous a adressé un avertissement. Consultez nos règles de la communauté.", to: "/aide" };
    case "university_suggestion_approved": return { title: "Université ajoutée", body: "Votre suggestion d'université a été acceptée.", to: "/universites" };
    case "university_suggestion_rejected": return { title: "Suggestion refusée", body: "Votre suggestion d'université n'a pas été retenue.", to: "/universites" };
    case "account_suspended": return { title: "Compte suspendu", body: "Votre compte a été suspendu. Contactez le support pour en savoir plus.", to: "/aide" };
    case "account_reactivated": return { title: "Compte réactivé", body: "Votre compte est de nouveau actif.", to: "/" };
    case "staff_invitation": return { title: "Invitation à l'équipe", body: "Vous avez été invité à rejoindre l'équipe d'administration.", to: "/admin" };
    case "new_device_detected": return { title: "Nouvel appareil détecté", body: "Une connexion depuis un nouvel appareil a eu lieu. Si ce n'était pas vous, changez votre mot de passe.", to: "/profil/parametres" };
    case "role_granted": return { title: "Nouveau rôle", body: "Des droits supplémentaires vous ont été accordés.", to: "/profil/parametres" };
    case "role_revoked": return { title: "Rôle retiré", body: "Certains de vos droits ont été retirés.", to: "/profil/parametres" };
    case "account_banned": return { title: "Compte bloqué", body: "Votre compte a été bloqué.", to: "/aide" };
    case "account_unbanned": return { title: "Compte débloqué", body: "Votre compte a été débloqué.", to: "/" };
    case "login_success": return { title: "Nouvelle connexion", body: "Vous vous êtes connecté à votre compte.", to: "/profil/parametres" };
    default: return { title: "Notification", body: "Vous avez une nouvelle notification.", to: "/notifications" };
  }
}

function groupOf(iso: string): AppNotification["group"] {
  const d = new Date(iso);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  if (d >= start) return "aujourdhui";
  if (d.getTime() >= start.getTime() - 86_400_000) return "hier";
  return "avant";
}

export async function fetchNotifications(): Promise<AppNotification[]> {
  const { data, error } = await requireSupabase()
    .from("notifications")
    .select("id, category, type, target_type, target_id, payload, read_at, created_at, actor:profiles!actor_id(full_name)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const actor = Array.isArray(r.actor) ? r.actor[0] : r.actor;
    const d = describe({ ...r, actorName: actor?.full_name });
    return { id: r.id, category: r.category, type: r.type, ...d, time: timeAgo(r.created_at), group: groupOf(r.created_at), unread: r.read_at === null, createdAt: r.created_at };
  });
}

async function setRead(ids: string[] | "all", read: boolean): Promise<void> {
  let q = requireSupabase().from("notifications").update({ read_at: read ? new Date().toISOString() : null });
  q = ids === "all" ? q.is("read_at", null) : q.in("id", ids);
  const { error } = await q;
  if (error) throw error;
}

export async function deleteNotification(id: string): Promise<void> {
  const { error } = await requireSupabase().from("notifications").delete().eq("id", id);
  if (error) throw error;
}

/* ---------- Préférences (par catégorie : dans l'application, e-mail) ---------- */

export type NotifPrefs = Record<NotifCategory, { inApp: boolean; email: boolean }>;
export const defaultPrefs: NotifPrefs = Object.fromEntries(notifCategories.map((c) => [c, { inApp: true, email: c === "message" || c === "achat" || c === "systeme" || c === "securite" }])) as NotifPrefs;

export async function fetchPrefs(userId: string): Promise<NotifPrefs> {
  const { data, error } = await requireSupabase().from("notification_preferences").select("category, in_app, email").eq("user_id", userId);
  if (error) throw error;
  const prefs: NotifPrefs = structuredClone(defaultPrefs);
  for (const r of (data ?? []) as { category: NotifCategory; in_app: boolean; email: boolean }[]) prefs[r.category] = { inApp: r.in_app, email: r.email };
  return prefs;
}

export async function savePrefs(userId: string, prefs: NotifPrefs): Promise<void> {
  const rows = notifCategories.map((category) => ({ user_id: userId, category, in_app: category === "securite" ? true : prefs[category].inApp, email: category === "securite" ? true : prefs[category].email }));
  const { error } = await requireSupabase().from("notification_preferences").upsert(rows, { onConflict: "user_id,category" });
  if (error) throw error;
}

/* ---------- Hooks ---------- */

const enabled = () => getSupabase() !== null;

export function useNotifications(userId: string | undefined) {
  return useQuery({ queryKey: ["notifications", userId], queryFn: fetchNotifications, enabled: enabled() && !!userId, staleTime: 15_000 });
}

/** Rafraîchit les notifications dès qu'une arrive (Realtime, filtré par la RLS). */
export function useNotificationsRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    const channel = sb.channel(`notifications-${userId}`).on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => { void qc.invalidateQueries({ queryKey: ["notifications"] }); }).subscribe();
    return () => { void sb.removeChannel(channel); };
  }, [userId, qc]);
}

export function useNotificationActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  return {
    read: useMutation({ mutationFn: (ids: string[]) => setRead(ids, true), onSuccess: refresh }),
    unread: useMutation({ mutationFn: (ids: string[]) => setRead(ids, false), onSuccess: refresh }),
    readAll: useMutation({ mutationFn: () => setRead("all", true), onSuccess: refresh }),
    remove: useMutation({ mutationFn: deleteNotification, onSuccess: refresh }),
  };
}

export function useNotifPrefs(userId: string | undefined) {
  return useQuery({ queryKey: ["notif-prefs", userId], queryFn: () => fetchPrefs(userId!), enabled: enabled() && !!userId, staleTime: 60_000 });
}

export function useSaveNotifPrefs(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (prefs: NotifPrefs) => savePrefs(userId!, prefs), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notif-prefs"] }); } });
}
