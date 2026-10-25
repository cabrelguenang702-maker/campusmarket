import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/cm/feedback";
import { ShieldCheck } from "@/components/icons";
import { acceptStaffInvitation, ROLE_LABEL, type StaffRole } from "@/lib/api/admin-team";
import { friendlyError } from "@/lib/api/errors";

export const Route = createFileRoute("/_app/invitation-equipe/$id")({
  head: () => ({ meta: [{ title: "Invitation à l'équipe — CampusMarket" }] }),
  component: StaffInvitationPage,
});

function StaffInvitationPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [role, setRole] = useState<StaffRole | null>(null);
  const accept = useMutation({
    mutationFn: () => acceptStaffInvitation(id),
    onSuccess: (r) => { setRole(r); void qc.invalidateQueries(); },
  });

  return (
    <div className="mx-auto max-w-md px-4 py-10 text-center">
      <span className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-primary/10 text-primary"><ShieldCheck className="size-7" /></span>
      {role ? (
        <>
          <h1 className="font-display text-xl font-bold">Bienvenue dans l'équipe</h1>
          <p className="mt-2 text-sm text-muted-foreground">Votre rôle : <strong className="text-foreground">{ROLE_LABEL[role]}</strong>. Activez la double authentification pour utiliser les actions sensibles.</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button asChild><Link to="/admin/securite">Sécuriser mon compte</Link></Button>
            <Button asChild variant="outline"><Link to="/admin">Ouvrir l'administration</Link></Button>
          </div>
        </>
      ) : (
        <>
          <h1 className="font-display text-xl font-bold">Invitation à rejoindre l'équipe</h1>
          <p className="mt-2 text-sm text-muted-foreground">Un administrateur vous invite à rejoindre l'équipe de CampusMarket. L'invitation n'est valable que pour l'adresse e-mail confirmée de ce compte.</p>
          {accept.isError && <div className="mt-4 text-left"><InlineAlert tone="danger">{friendlyError(accept.error, "Impossible d'accepter l'invitation.")}</InlineAlert></div>}
          <Button className="mt-5" onClick={() => accept.mutate()} disabled={accept.isPending}>{accept.isPending ? "Validation…" : "Accepter l'invitation"}</Button>
        </>
      )}
    </div>
  );
}
