import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/cm/setting-row";
import { InlineAlert, Spinner } from "@/components/cm/feedback";
import { PUSH_PROVIDER, PushUserError, disablePush, enablePush, getPushStatus, type PushStatus } from "@/lib/push";
import { friendlyError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";

/** Notifications push sur CET appareil. N'apparaît que si un fournisseur push est configuré (VITE_PUSH_PROVIDER).
 *  Les catégories reçues en push suivent le réglage « Dans l'app » du tableau ci-dessous. */
export function PushSettings() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [status, setStatus] = useState<PushStatus | "loading">("loading");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => { if (userId) setStatus(await getPushStatus(userId)); }, [userId]);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!PUSH_PROVIDER || !userId) return null;

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof PushUserError ? e.message : friendlyError(e, "Impossible de modifier les notifications. Réessayez."));
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  return (
    <SettingsCard title="Notifications sur cet appareil" description="Recevez une alerte sur votre téléphone ou votre ordinateur, même quand CampusMarket est fermé. Les types reçus suivent la colonne « Dans l'app » ci-dessous.">
      {status === "loading" ? (
        <div className="grid place-items-center py-4"><Spinner /></div>
      ) : status === "unsupported" ? (
        <InlineAlert tone="info">Ce navigateur ne prend pas en charge les notifications push.</InlineAlert>
      ) : status === "needs_install" ? (
        <InlineAlert tone="info" title="Ajoutez d'abord l'application à l'écran d'accueil">Sur iPhone et iPad, les notifications ne fonctionnent qu'une fois CampusMarket ajouté à l'écran d'accueil (Partager, puis « Sur l'écran d'accueil »). Ouvrez-le ensuite depuis cette icône.</InlineAlert>
      ) : status === "denied" ? (
        <InlineAlert tone="warning" title="Notifications bloquées">Vous les avez refusées pour ce site. Autorisez-les dans les réglages de votre navigateur (cadenas près de l'adresse), puis revenez ici.</InlineAlert>
      ) : status === "on" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">Activées sur cet appareil.</p>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(disablePush, "Notifications désactivées sur cet appareil")}>{busy ? "Un instant…" : "Désactiver"}</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Désactivées sur cet appareil.</p>
          <Button size="sm" disabled={busy} onClick={() => void run(() => enablePush(userId), "Notifications activées sur cet appareil")}>{busy ? "Un instant…" : "Activer"}</Button>
        </div>
      )}
    </SettingsCard>
  );
}
