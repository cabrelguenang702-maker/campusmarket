import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BadgeCheck, Plus } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Avatar } from "@/components/cm/commerce";
import { SearchField } from "@/components/cm/forms";
import { EmptyScreen, NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { useConversations } from "@/lib/api/messages";
import { isNetworkError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";
import { useMessagesUi } from "./MessagesUi";

export function ConversationList({ activeId, className }: { activeId?: string | undefined; className?: string | undefined }) {
  const { session } = useAuth();
  const { setNewOpen } = useMessagesUi();
  const [tab, setTab] = useState<"toutes" | "non-lues" | "archivees">("toutes");
  const [q, setQ] = useState("");
  const query = useConversations(session?.user.id);

  const list = (query.data ?? []).filter((c) => {
    if (tab === "archivees" ? !c.archived : c.archived) return false;
    if (tab === "non-lues" && c.unread === 0) return false;
    const s = q.trim().toLowerCase();
    return !s || c.name.toLowerCase().includes(s) || c.last.toLowerCase().includes(s) || (c.product?.name.toLowerCase().includes(s) ?? false);
  });

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between gap-2"><h1 className="font-display text-xl font-bold">Messages</h1><Button size="sm" onClick={() => setNewOpen(true)}><Plus /> Nouveau</Button></div>
        <SearchField className="mt-3" placeholder="Rechercher une conversation" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une conversation" />
        <div className="mt-3 flex gap-1.5" role="tablist" aria-label="Filtrer les conversations">
          {([["toutes", "Toutes"], ["non-lues", "Non lues"], ["archivees", "Archivées"]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold transition", tab === id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground")}>{label}</button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isLoading ? (
          <ul aria-busy className="divide-y divide-border">{[0, 1, 2, 3, 4].map((i) => <li key={i} className="flex gap-3 p-4"><div className="size-11 animate-pulse rounded-full bg-foreground/10" /><div className="flex-1 space-y-2"><div className="h-3.5 w-1/3 animate-pulse rounded bg-foreground/10" /><div className="h-3 w-3/4 animate-pulse rounded bg-foreground/10" /></div></li>)}</ul>
        ) : query.isError ? (
          isNetworkError(query.error) ? <NetworkErrorScreen compact onRetry={() => void query.refetch()} /> : <ServerErrorScreen compact onRetry={() => void query.refetch()} />
        ) : list.length === 0 ? (
          <EmptyScreen compact title={q ? "Aucune conversation trouvée" : tab === "archivees" ? "Aucune conversation archivée" : tab === "non-lues" ? "Aucun message non lu" : "Aucune conversation"} description={q ? "Essayez un autre nom ou un autre mot-clé." : "Écrivez à un vendeur depuis une annonce, ou démarrez une conversation avec « Nouveau »."} />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((c) => {
              const active = c.id === activeId;
              return (
                <li key={c.id}>
                  <AppLink to={`/messages/${c.id}`} aria-current={active ? "page" : undefined} className={cn("flex gap-3 px-4 py-3.5 transition hover:bg-accent/40", active && "bg-primary/8 shadow-[inset_3px_0_0_var(--primary)]")}>
                    <Avatar name={c.name} size="md" src={c.avatarUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1 truncate text-sm font-semibold">{c.name}{c.verified && <BadgeCheck className="size-3.5 shrink-0 text-primary" />}</span><span className={cn("shrink-0 text-[11px]", c.unread ? "font-semibold text-primary" : "text-muted-foreground")}>{c.lastLabel}</span></span>
                      {c.product && <span className="mt-0.5 block truncate text-[11px] font-semibold text-primary">{c.product.name}</span>}
                      <span className="mt-0.5 flex items-center justify-between gap-2"><span className={cn("truncate text-[13px]", c.unread ? "font-semibold text-foreground" : "text-muted-foreground")}>{c.last}</span>{c.unread > 0 && <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{c.unread}</span>}</span>
                    </span>
                  </AppLink>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
