import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Clock, LogOut, UserPlus, X } from "@/components/icons";
import { ConfirmDialog } from "@/components/cm/feedback";
import { friendlyError } from "@/lib/api/errors";
import { useSpaceActions } from "@/lib/api/spaces";
import { useAuth } from "@/lib/auth";
import { isMember, kindLabels, type MyStatus, type Space } from "@/lib/spaces-model";

/** Rejoindre / quitter / demander / annuler la demande. L'espace public s'ouvre directement ; le privé passe par une demande. */
export function JoinButton({ space, status, size = "default" }: { space: Space; status: MyStatus; size?: "default" | "sm" | "lg" }) {
  const { session } = useAuth();
  const actions = useSpaceActions(session?.user.id);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const label = kindLabels[space.kind];
  const fail = (title: string) => (e: unknown) => toast.error(title, { description: friendlyError(e) });

  if (isMember(status)) {
    return (
      <>
        <Button size={size} variant="outline" disabled={actions.leave.isPending} onClick={() => setConfirmLeave(true)}><LogOut /> Quitter</Button>
        <ConfirmDialog open={confirmLeave} onOpenChange={setConfirmLeave} destructive title={`Quitter ${space.name} ?`} description={`Vous ne verrez plus les publications de ${label.the}. Vous pourrez la rejoindre à nouveau plus tard.`} confirmLabel="Quitter"
          onConfirm={() => actions.leave.mutate(space.id, { onSuccess: () => toast(`Vous avez quitté ${space.name}`), onError: fail("Impossible de quitter") })} />
      </>
    );
  }
  if (status === "attente") {
    return <Button size={size} variant="outline" disabled={actions.cancelRequest.isPending} onClick={() => actions.cancelRequest.mutate(space.id, { onSuccess: () => toast("Demande annulée"), onError: fail("Annulation impossible") })}><X /> Annuler la demande</Button>;
  }
  if (space.privacy === "invitation") return <Button size={size} variant="outline" disabled><Clock /> Sur invitation</Button>;
  const priv = space.privacy === "privee";
  return (
    <Button size={size} disabled={actions.join.isPending} onClick={() => actions.join.mutate(space, {
      onSuccess: () => (priv ? toast.success("Demande envoyée", { description: "Un administrateur doit approuver votre demande." }) : toast.success(`Vous avez rejoint ${space.name}`)),
      onError: fail(priv ? "Demande impossible" : "Impossible de rejoindre"),
    })}>
      {priv ? <><Clock /> Demander à rejoindre</> : <><UserPlus /> Rejoindre</>}
    </Button>
  );
}
