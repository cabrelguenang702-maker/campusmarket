import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowLeft, Checks, MoreHorizontal, Settings, Trash, Undo } from "@/components/icons";
import { toneSolidIcon } from "@/components/cm/badges";
import { EmptyScreen, NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { NotificationPreferences } from "@/components/settings/NotificationPreferences";
import { PageHeader } from "@/components/layout/PageHeader";
import { categoryMeta, splitTo } from "@/lib/notification-meta";
import { notifCategories, useNotificationActions, useNotifications, type AppNotification, type NotifCategory } from "@/lib/api/notifications";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/notifications")({
  head: () => ({ meta: [{ title: "Notifications — CampusMarket" }] }),
  component: NotificationsPage,
});

const groups = [["aujourdhui", "Aujourd'hui"], ["hier", "Hier"], ["avant", "Plus ancien"]] as const;

function Row({ item, onOpen, onToggle, onDelete }: { item: AppNotification; onOpen: () => void; onToggle: () => void; onDelete: () => void }) {
  const { icon: Icon, tone, label } = categoryMeta[item.category];
  return (
    <li className={cn("group relative flex items-start gap-3 px-4 py-3.5 transition hover:bg-accent/40", item.unread && "bg-primary/5")}>
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 text-left" aria-label={`${item.title} — ${item.body}`}>
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", toneSolidIcon[tone])}><Icon className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2"><span className={cn("truncate text-sm", item.unread ? "font-bold" : "font-semibold")}>{item.title}</span><span className="shrink-0 text-[11px] text-muted-foreground">{item.time}</span></span>
          <span className="mt-0.5 line-clamp-2 block text-[13px] leading-5 text-muted-foreground">{item.body}</span>
          <span className="mt-1.5 inline-block text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">{label}</span>
        </span>
        {item.unread && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-primary" aria-label="Non lue" />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="-mr-2 size-8 shrink-0" aria-label="Actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onToggle} className="cursor-pointer">{item.unread ? <><Checks /> Marquer comme lue</> : <><Undo /> Marquer comme non lue</>}</DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} className="cursor-pointer text-destructive focus:text-destructive"><Trash /> Supprimer</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function NotificationsPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const q = useNotifications(session?.user.id);
  const actions = useNotificationActions();
  const [tab, setTab] = useState<"toutes" | "non-lues" | "lues">("toutes");
  const [category, setCategory] = useState<NotifCategory | "tous">("tous");
  const [prefs, setPrefs] = useState(false);

  const items = q.data ?? [];
  const unreadCount = items.filter((i) => i.unread).length;
  const visible = useMemo(() => items.filter((i) => (category === "tous" || i.category === category) && (tab === "toutes" || (tab === "non-lues" ? i.unread : !i.unread))), [items, category, tab]);

  const fail = (e: unknown) => toast.error(friendlyError(e, "Action impossible pour le moment."));
  const open = (item: AppNotification) => {
    if (item.unread) actions.read.mutate([item.id], { onError: fail });
    const { to, search } = splitTo(item.to);
    void navigate({ to: to as "/", search: search as never });
  };
  const markAll = () => actions.readAll.mutate(undefined, { onSuccess: () => toast.success("Toutes les notifications sont lues"), onError: fail });

  const header = (
    <PageHeader kicker="Mon espace" title={prefs ? "Paramètres des notifications" : "Notifications"} description={prefs ? "Choisissez ce qui vous est envoyé, et comment." : unreadCount > 0 ? `${unreadCount} notification${unreadCount > 1 ? "s" : ""} non lue${unreadCount > 1 ? "s" : ""}.` : "Vous êtes à jour."}
      breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Notifications" }]}
      actions={prefs ? <Button variant="outline" onClick={() => setPrefs(false)}><ArrowLeft /> Retour</Button> : <>
        <Button variant="outline" disabled={unreadCount === 0 || actions.readAll.isPending} onClick={markAll}><Checks /> Tout marquer comme lu</Button>
        <Button variant="outline" size="icon" aria-label="Paramètres des notifications" onClick={() => setPrefs(true)}><Settings /></Button></>} />
  );

  if (prefs) return <div>{header}<div className="max-w-2xl"><NotificationPreferences /></div></div>;

  return (
    <div>
      {header}
      <div className="max-w-3xl">
        <div className="mb-3 inline-flex rounded-lg bg-muted p-1" role="tablist" aria-label="Filtrer par lecture">
          {([["toutes", "Toutes"], ["non-lues", `Non lues (${unreadCount})`], ["lues", "Lues"]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("rounded-md px-4 py-2 text-sm font-semibold transition", tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{label}</button>
          ))}
        </div>
        <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0" role="group" aria-label="Filtrer par type">
          {(["tous", ...notifCategories] as (NotifCategory | "tous")[]).map((c) => (
            <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)} className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition", category === c ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{c === "tous" ? "Toutes catégories" : categoryMeta[c].label}</button>
          ))}
        </div>

        {q.isLoading ? (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" aria-busy>{[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex gap-3 p-4"><div className="size-10 animate-pulse rounded-lg bg-foreground/10" /><div className="flex-1 space-y-2"><div className="h-3.5 w-1/3 animate-pulse rounded bg-foreground/10" /><div className="h-3 w-3/4 animate-pulse rounded bg-foreground/10" /></div></div>)}</div>
        ) : q.isError ? (
          isNetworkError(q.error) ? <NetworkErrorScreen compact onRetry={() => void q.refetch()} /> : <ServerErrorScreen compact onRetry={() => void q.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyScreen compact title={items.length === 0 ? "Aucune notification" : tab === "non-lues" ? "Tout est lu" : "Rien à afficher"} description={items.length === 0 ? "Vos messages, achats et alertes apparaîtront ici." : tab === "non-lues" ? "Vous avez lu toutes vos notifications." : "Aucune notification ne correspond à ce filtre."} />
        ) : (
          <div className="space-y-5">
            {groups.map(([key, label]) => {
              const list = visible.filter((i) => i.group === key);
              if (list.length === 0) return null;
              return (
                <section key={key}>
                  <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</h2>
                  <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                    {list.map((item) => <Row key={item.id} item={item} onOpen={() => open(item)} onToggle={() => (item.unread ? actions.read : actions.unread).mutate([item.id], { onError: fail })} onDelete={() => actions.remove.mutate(item.id, { onSuccess: () => toast("Notification supprimée"), onError: fail })} />)}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
