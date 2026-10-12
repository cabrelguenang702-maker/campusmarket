import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { MessageCircle, Plus } from "@/components/icons";
import { StateScreen } from "@/components/cm/feedback";
import { useMessagesUi } from "@/components/messages/MessagesUi";

export const Route = createFileRoute("/_app/messages/")({
  component: NoConversationSelected,
});

/** Panneau de droite (desktop) quand aucune conversation n'est ouverte. */
function NoConversationSelected() {
  const { setNewOpen } = useMessagesUi();
  return (
    <div className="grid flex-1 place-items-center">
      <StateScreen compact icon={MessageCircle} tone="primary" title="Sélectionnez une conversation" description="Choisissez une conversation dans la liste ou démarrez-en une nouvelle pour échanger avec un étudiant." actions={<Button onClick={() => setNewOpen(true)}><Plus /> Nouvelle conversation</Button>} />
    </div>
  );
}
