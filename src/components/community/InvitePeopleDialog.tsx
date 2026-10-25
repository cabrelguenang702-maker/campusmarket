import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchField } from "@/components/cm/forms";
import { Avatar } from "@/components/cm/commerce";
import { Spinner } from "@/components/cm/feedback";
import { friendlyError } from "@/lib/api/errors";
import { useInvitePerson, usePeopleSearch } from "@/lib/api/spaces-manage";
import { useAuth } from "@/lib/auth";
import { kindLabels, type Space } from "@/lib/spaces-model";

/** Invitation de personnes par un administrateur : la personne reçoit une notification et accepte ou refuse. */
export function InvitePeopleDialog({ space, memberIds, open, onOpenChange }: { space: Space; memberIds: ReadonlySet<string>; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const label = kindLabels[space.kind];
  const [q, setQ] = useState("");
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const search = usePeopleSearch(q, userId);
  const invite = useInvitePerson(space.id, userId);
  const results = (search.data ?? []).filter((p) => !memberIds.has(p.id));

  const send = (id: string, name: string) => invite.mutate(id, {
    onSuccess: () => { setSent((s) => new Set(s).add(id)); toast.success(`Invitation envoyée à ${name}`); },
    onError: (e) => toast.error("Invitation impossible", { description: friendlyError(e) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display">Inviter des personnes</DialogTitle><DialogDescription>Recherchez un étudiant par son nom : il pourra rejoindre {label.the} en acceptant l'invitation. Seules les personnes qui acceptent d'être trouvées apparaissent.</DialogDescription></DialogHeader>
        <SearchField value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom de la personne…" aria-label="Rechercher une personne" />
        <div className="min-h-24" aria-live="polite">
          {q.trim().length < 2 ? <p className="py-6 text-center text-sm text-muted-foreground">Saisissez au moins 2 lettres.</p>
            : search.isPending ? <div className="grid place-items-center py-6"><Spinner className="size-5" /></div>
            : search.isError ? <p className="py-6 text-center text-sm text-muted-foreground">Recherche impossible. <button className="font-semibold text-primary hover:underline" onClick={() => void search.refetch()}>Réessayer</button></p>
            : results.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Aucune personne trouvée.</p>
            : <ul className="mt-2 divide-y divide-border">{results.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <Avatar name={p.name} size="md" src={p.avatarUrl} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{p.name}</span>{p.campus && <span className="block truncate text-xs text-muted-foreground">{p.campus}</span>}</span>
                  <Button size="sm" variant={sent.has(p.id) ? "outline" : "default"} disabled={sent.has(p.id) || invite.isPending} onClick={() => send(p.id, p.name)}>{sent.has(p.id) ? "Invité" : "Inviter"}</Button>
                </li>))}</ul>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
