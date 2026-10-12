import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BadgeCheck, Search } from "@/components/icons";
import { Avatar } from "@/components/cm/commerce";
import { SearchField } from "@/components/cm/forms";
import { Spinner, StateScreen } from "@/components/cm/feedback";
import { searchPeople } from "@/lib/api/messages";
import { findOrCreateConversation } from "@/lib/api/engagement";
import { friendlyError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";
import { useMessagesUi } from "./MessagesUi";

/** Nouvelle conversation : recherche d'un membre puis ouverture (ou création) de la conversation. */
export function NewConversationDialog() {
  const { newOpen, setNewOpen } = useMessagesUi();
  const { session } = useAuth();
  const userId = session?.user.id;
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => { if (newOpen) { setQ(""); setTerm(""); } }, [newOpen]);
  useEffect(() => { const t = window.setTimeout(() => setTerm(q.trim()), 250); return () => window.clearTimeout(t); }, [q]);

  const people = useQuery({ queryKey: ["people-search", term, userId], queryFn: () => searchPeople(term, userId!), enabled: newOpen && !!userId, staleTime: 30_000 });
  const results = people.data ?? [];

  const open = async (personId: string) => {
    if (!userId || opening) return;
    setOpening(personId);
    try {
      const id = await findOrCreateConversation(userId, personId);
      setNewOpen(false);
      void navigate({ to: `/messages/${id}` as "/" });
    } catch (e) {
      toast.error(friendlyError(e, "Impossible d'ouvrir la conversation."));
    } finally {
      setOpening(null);
    }
  };

  return (
    <Dialog open={newOpen} onOpenChange={setNewOpen}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader><DialogTitle className="font-display">Nouvelle conversation</DialogTitle><DialogDescription>Recherchez un étudiant par son nom ou son campus.</DialogDescription></DialogHeader>
        <SearchField autoFocus placeholder="Rechercher un utilisateur" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un utilisateur" />
        <div className="max-h-72 overflow-y-auto">
          {people.isLoading ? (
            <div className="grid place-items-center py-8"><Spinner /></div>
          ) : people.isError ? (
            <StateScreen compact icon={Search} tone="danger" title="Recherche impossible" description="Vérifiez votre connexion puis réessayez." />
          ) : results.length === 0 ? (
            <StateScreen compact icon={Search} tone="neutral" title="Aucun utilisateur trouvé" description={term ? `Aucun résultat pour « ${term} ». Vérifiez l'orthographe ou essayez un campus.` : "Aucun autre membre pour le moment."} />
          ) : (
            <>
              {!term && <p className="mb-1 px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Membres récents</p>}
              <ul>
                {results.map((p) => (
                  <li key={p.id}>
                    <button disabled={opening !== null} onClick={() => void open(p.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-accent disabled:opacity-60">
                      <Avatar name={p.name} size="md" src={p.avatarUrl} />
                      <span className="min-w-0 flex-1"><span className="flex items-center gap-1 text-sm font-semibold">{p.name}{p.verified && <BadgeCheck className="size-3.5 text-primary" />}</span><span className="block truncate text-xs text-muted-foreground">{p.campus ?? "Campus non renseigné"}</span></span>
                      {opening === p.id && <Spinner className="size-4" />}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
