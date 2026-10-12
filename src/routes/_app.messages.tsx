import { useMemo, useState } from "react";
import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { ConversationList } from "@/components/messages/ConversationList";
import { MessagesUiContext } from "@/components/messages/MessagesUi";
import { NewConversationDialog } from "@/components/messages/NewConversationDialog";
import { cn } from "@/lib/utils";

/** Layout de la messagerie : liste à gauche, conversation à droite (une seule colonne sur mobile). */
export const Route = createFileRoute("/_app/messages")({
  head: () => ({ meta: [{ title: "Messages — CampusMarket" }] }),
  component: MessagesLayout,
});

function MessagesLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeId = pathname.startsWith("/messages/") ? decodeURIComponent(pathname.slice("/messages/".length)) : undefined;
  const [newOpen, setNewOpen] = useState(false);
  const ctx = useMemo(() => ({ newOpen, setNewOpen }), [newOpen]);

  return (
    <MessagesUiContext.Provider value={ctx}>
      <div className="flex h-[72vh] min-h-[520px] overflow-hidden rounded-xl border border-border bg-card">
        <ConversationList activeId={activeId} className={cn("w-full shrink-0 border-border lg:w-[340px] lg:border-r", activeId ? "hidden lg:flex" : "flex")} />
        <div className={cn("min-w-0 flex-1 flex-col", activeId ? "flex" : "hidden lg:flex")}><Outlet /></div>
      </div>
      <NewConversationDialog />
    </MessagesUiContext.Provider>
  );
}
