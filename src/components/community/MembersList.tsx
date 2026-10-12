import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SearchField } from "@/components/cm/forms";
import { Avatar } from "@/components/cm/commerce";
import { Pill } from "@/components/cm/badges";
import { ConfirmDialog, Spinner, StateScreen } from "@/components/cm/feedback";
import { NetworkErrorScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { AppLink } from "@/components/cm/app-link";
import { Check, Crown, MoreVertical, Search, Shield, UserMinus, UserX, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { useJoinRequests, useMemberActions, useSpaceMembers, type SpaceMember } from "@/lib/api/spaces";
import { useAuth } from "@/lib/auth";
import { timeAgo } from "@/lib/domain";
import { canAdminister, roleLabel, type MyStatus, type Space, type SpaceRole } from "@/lib/spaces-model";

const roleTone: Record<SpaceRole, "primary" | "info" | "neutral"> = { owner: "primary", admin: "primary", moderator: "info", member: "neutral" };
const roleIcon: Record<SpaceRole, typeof Crown | undefined> = { owner: Crown, admin: Crown, moderator: Shield, member: undefined };

/** Ce que `actor` a le droit de faire sur `target` (miroir de la hiérarchie imposée par la base : owner > admin > moderator > member). */
function allowed(actor: MyStatus, target: SpaceRole) {
  const owner = actor === "owner";
  const admin = actor === "admin";
  const mod = actor === "moderator";
  return {
    makeModerator: (owner || admin) && target === "member",
    removeModerator: (owner || admin) && target === "moderator",
    makeAdmin: owner && (target === "member" || target === "moderator"),
    removeAdmin: owner && target === "admin",
    exclude: target !== "owner" && ((owner) || (admin && (target === "moderator" || target === "member")) || (mod && target === "member")),
  };
}

/** Demandes d'adhésion en attente (espaces privés), visibles par les administrateurs. */
function RequestsPanel({ spaceId }: { spaceId: string }) {
  const query = useJoinRequests(spaceId, true);
  const actions = useMemberActions(spaceId);
  const list = query.data ?? [];
  if (query.isPending || list.length === 0) return null;
  return (
    <section className="mb-5 rounded-xl border border-warning/40 bg-warning/10 p-4">
      <h2 className="font-display text-sm font-bold">Demandes en attente ({list.length})</h2>
      <ul className="mt-3 space-y-2">
        {list.map((r) => (
          <li key={r.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
            <Avatar name={r.name} size="md" src={r.avatarUrl} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{r.name}</span><span className="block text-xs text-muted-foreground">Demande {timeAgo(r.createdAt)}</span></span>
            <Button size="sm" variant="outline" disabled={actions.decide.isPending} onClick={() => actions.decide.mutate({ requestId: r.id, approve: false }, { onSuccess: () => toast("Demande refusée"), onError: (e) => toast.error("Action impossible", { description: friendlyError(e) }) })}><X /> Refuser</Button>
            <Button size="sm" disabled={actions.decide.isPending} onClick={() => actions.decide.mutate({ requestId: r.id, approve: true }, { onSuccess: () => toast.success(`${r.name} a rejoint l'espace`), onError: (e) => toast.error("Action impossible", { description: friendlyError(e) }) })}><Check /> Accepter</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Liste des membres, partagée par communautés et groupes, avec actions de gestion selon le rôle. */
export function MembersList({ space, myStatus }: { space: Space; myStatus: MyStatus }) {
  const { session } = useAuth();
  const me = session?.user.id;
  const query = useSpaceMembers(space.id, true);
  const actions = useMemberActions(space.id);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"tous" | "responsables">("tous");
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);

  if (query.isPending) return <div className="grid place-items-center py-12"><Spinner className="size-6" /></div>;
  if (query.isError) return isNetworkError(query.error) ? <NetworkErrorScreen compact onRetry={() => void query.refetch()} /> : <ServerErrorScreen compact onRetry={() => void query.refetch()} />;

  const members = query.data ?? [];
  if (members.length === 0) return <StateScreen compact icon={Search} title="Aucun membre" description="Cet espace n'a pas encore de membre visible." />;
  const leaders = members.filter((m) => m.role !== "member");
  const list = members.filter((m) => (tab === "tous" || m.role !== "member") && (!q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase())));
  const row = (m: SpaceMember) => <MemberRow key={m.userId} member={m} isMe={m.userId === me} actor={myStatus} onExclude={setConfirm} spaceId={space.id} />;


  return (
    <div>
      {canAdminister(myStatus) && <RequestsPanel spaceId={space.id} />}
      <SearchField placeholder="Rechercher un membre" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un membre" />
      <div className="mt-4 flex gap-1.5" role="tablist" aria-label="Filtrer les membres">
        {([["tous", `Tous (${members.length})`], ["responsables", `Responsables (${leaders.length})`]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("rounded-full px-3.5 py-1.5 text-xs font-semibold transition", tab === id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground")}>{label}</button>
        ))}
      </div>

      {tab === "tous" && leaders.length > 0 && !q && (
        <div className="mt-4"><p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Responsables</p><ul className="space-y-2">{leaders.map(row)}</ul></div>
      )}

      <div className="mt-4">
        {tab === "tous" && !q && <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Membres</p>}
        {list.length === 0 ? <NoResultsScreen compact query={q} /> : <ul className="space-y-2">{(tab === "tous" && !q ? list.filter((m) => m.role === "member") : list).map(row)}</ul>}
      </div>

      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} destructive title={`Exclure ${confirm?.name ?? ""} ?`} description="Cette personne ne fera plus partie de l'espace. Elle pourra demander à le rejoindre à nouveau." confirmLabel="Exclure"
        onConfirm={() => { if (confirm) actions.remove.mutate(confirm.id, { onSuccess: () => toast.success(`${confirm.name} a été exclu·e`), onError: (e) => toast.error("Exclusion impossible", { description: friendlyError(e) }) }); }} />
    </div>
  );
}

function MemberRow({ member, isMe, actor, onExclude, spaceId }: { member: SpaceMember; isMe: boolean; actor: MyStatus; onExclude: (v: { id: string; name: string }) => void; spaceId: string }) {
  const actions = useMemberActions(spaceId);
  const Icon = roleIcon[member.role];
  const can = allowed(actor, member.role);
  const hasActions = !isMe && Object.values(can).some(Boolean);
  const setRole = (role: Exclude<SpaceRole, "owner">, done: string) => actions.setRole.mutate({ userId: member.userId, role }, { onSuccess: () => toast.success(done), onError: (e) => toast.error("Changement impossible", { description: friendlyError(e) }) });
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <AppLink to={`/boutique/${member.userId}`}><Avatar name={member.name} size="md" src={member.avatarUrl} /></AppLink>
      <AppLink to={`/boutique/${member.userId}`} className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold hover:text-primary">{member.name}{isMe && " (vous)"}</span><span className="block truncate text-xs text-muted-foreground">{member.campus ?? ""}</span></AppLink>
      <Pill tone={roleTone[member.role]} icon={Icon}>{roleLabel[member.role]}</Pill>
      {hasActions && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Actions pour ${member.name}`}><MoreVertical /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {can.makeAdmin && <DropdownMenuItem className="cursor-pointer" onClick={() => setRole("admin", `${member.name} est maintenant administrateur·rice`)}><Crown /> Nommer administrateur</DropdownMenuItem>}
            {can.makeModerator && <DropdownMenuItem className="cursor-pointer" onClick={() => setRole("moderator", `${member.name} est maintenant modérateur·rice`)}><Shield /> Nommer modérateur</DropdownMenuItem>}
            {can.removeModerator && <DropdownMenuItem className="cursor-pointer" onClick={() => setRole("member", `${member.name} n'est plus modérateur·rice`)}><UserMinus /> Retirer la modération</DropdownMenuItem>}
            {can.removeAdmin && <DropdownMenuItem className="cursor-pointer" onClick={() => setRole("member", `${member.name} n'est plus administrateur·rice`)}><UserMinus /> Retirer l'administration</DropdownMenuItem>}
            {can.exclude && <><DropdownMenuSeparator /><DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={() => onExclude({ id: member.userId, name: member.name })}><UserX /> Exclure de l'espace</DropdownMenuItem></>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
