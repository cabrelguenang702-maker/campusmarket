import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/api/errors";
import { useMyInvitations, useRespondInvitation, type MyInvitation } from "@/lib/api/spaces-manage";
import { useAuth } from "@/lib/auth";
import { kindLabels } from "@/lib/spaces-model";

/** Invitations reçues, à accepter ou refuser. `spaceId` limite l'affichage à une seule communauté ou un seul groupe. */
export function InvitationsBanner({ spaceId }: { spaceId?: string | undefined }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const navigate = useNavigate();
  const query = useMyInvitations(userId);
  const respond = useRespondInvitation(userId);
  const list = (query.data ?? []).filter((i) => !spaceId || i.spaceId === spaceId);
  if (list.length === 0) return null;

  const answer = (i: MyInvitation, accept: boolean) => respond.mutate({ id: i.id, accept }, {
    onSuccess: () => {
      if (accept) { toast.success(`Bienvenue dans ${i.spaceName}`); void navigate({ to: `${kindLabels[i.kind].basePath}/${i.spaceId}` as "/" }); }
      else toast("Invitation refusée");
    },
    onError: (e) => toast.error("Action impossible", { description: friendlyError(e) }),
  });

  return (
    <section className="mb-5 rounded-xl border border-primary/30 bg-primary/5 p-4" aria-label="Invitations reçues">
      <h2 className="font-display text-sm font-bold">{list.length > 1 ? `Vous avez ${list.length} invitations` : "Vous avez une invitation"}</h2>
      <ul className="mt-3 space-y-2">
        {list.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
            <span className="min-w-0 flex-1 basis-48"><span className="block truncate text-sm font-semibold">{i.spaceName}</span><span className="block text-xs text-muted-foreground">{i.inviterName} vous invite à rejoindre {kindLabels[i.kind].the}</span></span>
            <Button size="sm" variant="outline" disabled={respond.isPending} onClick={() => answer(i, false)}>Refuser</Button>
            <Button size="sm" disabled={respond.isPending} onClick={() => answer(i, true)}>Accepter</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
