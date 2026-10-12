import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Pause } from "@/components/icons";
import { StateScreen, LoadingButtonLabel } from "@/components/cm/feedback";
import { friendlyError } from "@/lib/api/errors";
import { reactivateAccount } from "@/lib/api/security";

/** Affiché à la place de l'application quand le compte est désactivé : on peut le réactiver à tout moment. */
export function DeactivatedScreen({ onReactivated, onSignOut }: { onReactivated: () => Promise<void>; onSignOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const reactivate = async () => {
    setBusy(true);
    try {
      await reactivateAccount();
      await onReactivated();
      toast.success("Compte réactivé", { description: "Votre profil et vos annonces sont de nouveau visibles." });
    } catch (e) {
      toast.error("Réactivation impossible", { description: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <StateScreen icon={Pause} tone="primary" title="Votre compte est désactivé" description="Votre profil, vos annonces et vos demandes sont masqués aux autres étudiants. Vos données sont conservées : réactivez votre compte quand vous voulez."
        actions={<><Button size="lg" disabled={busy} onClick={() => void reactivate()}><LoadingButtonLabel loading={busy} loadingText="Réactivation…">Réactiver mon compte</LoadingButtonLabel></Button><Button size="lg" variant="outline" disabled={busy} onClick={onSignOut}>Se déconnecter</Button></>} />
    </div>
  );
}
