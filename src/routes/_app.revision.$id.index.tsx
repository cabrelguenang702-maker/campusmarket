import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AppLink } from "@/components/cm/app-link";
import { ConfirmDialog, InlineAlert } from "@/components/cm/feedback";
import { NetworkErrorScreen, NotFoundScreen, ServerErrorScreen } from "@/components/cm/screens";
import { GroupFormDialog } from "@/components/study/GroupFormDialog";
import { SessionDialog } from "@/components/study/SessionDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { BadgeCheck, BookOpen, CalendarDays, Clock, MapPin, Plus, UserPlus, Users } from "@/components/icons";
import { isNetworkError } from "@/lib/api/errors";
import { studyError, useGroupMembers, useGroupSessions, useStudyGroup, useStudyGroupActions, type GroupMember, type GroupSession, type RsvpStatus } from "@/lib/api/study-groups";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/revision/$id/")({
  head: () => ({ meta: [{ title: "Groupe de révision — CampusMarket" }] }),
  component: GroupPage,
});

const whenFmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const durationFmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}` : `${m} min`);
const isWebLink = (s: string) => /^https?:\/\/\S+$/i.test(s);

function SessionCard({ session, owner, names, onRsvp, onCancel, busy, readOnly }: {
  session: GroupSession; owner: boolean; names: Map<string, string>; onRsvp: (status: RsvpStatus | null) => void; onCancel: () => void; busy: boolean; readOnly: boolean;
}) {
  const goingNames = session.going.map((id) => names.get(id) ?? "Étudiant");
  const toggle = (s: RsvpStatus) => onRsvp(session.myStatus === s ? null : s);
  return (
    <li className={cn("rounded-xl border border-border bg-card p-4", (session.cancelled || readOnly) && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-base font-bold">{session.title}{(session.cancelled || readOnly) && <span className="ml-2 rounded-full border border-border bg-secondary px-2 py-0.5 align-middle text-xs font-semibold">{session.cancelled ? "Annulée" : "Terminée"}</span>}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5 capitalize"><CalendarDays className="size-4" /> {whenFmt(session.startsAt)}</span>
            <span className="flex items-center gap-1.5"><Clock className="size-4" /> {durationFmt(session.durationMinutes)}</span>
            {session.location && (
              <span className="flex min-w-0 items-center gap-1.5"><MapPin className="size-4 shrink-0" />
                {isWebLink(session.location) ? <a href={session.location} target="_blank" rel="noopener noreferrer" className="truncate font-semibold text-primary underline">Rejoindre en ligne</a> : <span className="truncate">{session.location}</span>}
              </span>
            )}
          </p>
        </div>
        {owner && !session.cancelled && !readOnly && <Button variant="ghost" size="sm" onClick={onCancel}>Annuler la séance</Button>}
      </div>
      {session.notes && <p className="mt-2 whitespace-pre-line text-sm">{session.notes}</p>}
      {!session.cancelled && !readOnly && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant={session.myStatus === "going" ? "default" : "outline"} aria-pressed={session.myStatus === "going"} disabled={busy} onClick={() => toggle("going")}>J'y vais</Button>
          <Button size="sm" variant={session.myStatus === "maybe" ? "default" : "outline"} aria-pressed={session.myStatus === "maybe"} disabled={busy} onClick={() => toggle("maybe")}>Peut-être</Button>
          <p className="text-xs text-muted-foreground">
            {session.going.length === 0 ? "Personne d'inscrit pour l'instant" : `${session.going.length} participant${session.going.length > 1 ? "s" : ""} : ${goingNames.slice(0, 4).join(", ")}${goingNames.length > 4 ? "…" : ""}`}
            {session.maybe.length > 0 ? ` · ${session.maybe.length} peut-être` : ""}
          </p>
        </div>
      )}
    </li>
  );
}

function MemberRow({ member, canKick, isSelf, onKick }: { member: GroupMember; canKick: boolean; isSelf: boolean; onKick: () => void }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">{member.name.charAt(0).toUpperCase()}</span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-medium">{member.name}{isSelf && <span className="text-xs text-muted-foreground">(vous)</span>}{member.verified && <BadgeCheck className="size-4 text-primary" aria-label="Profil vérifié" />}</p>
        <p className="text-xs text-muted-foreground">{member.role === "owner" ? "Propriétaire" : "Membre"}{member.campus ? ` · ${member.campus}` : ""}</p>
      </div>
      {canKick && <Button variant="ghost" size="sm" onClick={onKick}>Retirer</Button>}
    </li>
  );
}

function GroupPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const { session } = useAuth();
  const userId = session?.user.id;
  const groupQuery = useStudyGroup(id);
  const group = groupQuery.data;
  const isMember = group?.isMember === true;
  const members = useGroupMembers(id, isMember);
  const sessions = useGroupSessions(id, userId, isMember);
  const acts = useStudyGroupActions(userId);
  const [editing, setEditing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [confirm, setConfirm] = useState<null | "leave" | "archive" | { kind: "kick"; member: GroupMember } | { kind: "cancel"; session: GroupSession }>(null);

  const names = useMemo(() => new Map((members.data ?? []).map((m) => [m.userId, m.name])), [members.data]);
  const now = Date.now();
  const upcoming = (sessions.data ?? []).filter((s) => !s.cancelled && new Date(s.startsAt).getTime() + s.durationMinutes * 60_000 >= now);
  const past = (sessions.data ?? []).filter((s) => !upcoming.includes(s)).reverse();

  const run = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    try { await fn(); toast.success(ok); after?.(); } catch (e) { toast.error(studyError(e)); }
    setConfirm(null);
  };

  if (groupQuery.isPending) return <div aria-busy className="mx-auto max-w-4xl space-y-3"><div className="h-24 animate-pulse rounded-xl bg-foreground/10" /><div className="h-40 animate-pulse rounded-xl bg-foreground/10" /></div>;
  if (groupQuery.isError) return isNetworkError(groupQuery.error) ? <NetworkErrorScreen onRetry={() => void groupQuery.refetch()} /> : <ServerErrorScreen onRetry={() => void groupQuery.refetch()} />;
  if (!group) return <NotFoundScreen compact />;

  const full = group.memberCount >= group.maxMembers;
  const owner = group.isOwner;
  const leaveText = owner
    ? (group.memberCount > 1 ? "Vous êtes la propriétaire ou le propriétaire : le rôle sera transmis au membre le plus ancien." : "Vous êtes la dernière personne du groupe : il sera archivé.")
    : "Vous ne recevrez plus les notifications de ce groupe. Vous pourrez le rejoindre à nouveau s'il reste de la place.";

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader kicker={group.subject} title={group.title} description={group.description || undefined}
        breadcrumbs={[{ label: "Groupes de révision", to: "/revision" }, { label: group.title }]}
        actions={
          group.archived ? <span className="rounded-full border border-border bg-secondary px-3 py-1 text-sm font-semibold">Groupe archivé</span>
          : !isMember ? <Button disabled={full || acts.join.isPending} onClick={() => void run(() => acts.join.mutateAsync(group.id), "Vous avez rejoint le groupe.")}><UserPlus /> {full ? "Groupe complet" : "Rejoindre le groupe"}</Button>
          : owner ? <><Button onClick={() => setPlanning(true)}><Plus /> Programmer une séance</Button><Button variant="outline" onClick={() => setEditing(true)}>Modifier</Button><Button variant="ghost" onClick={() => setConfirm("archive")}>Archiver</Button></>
          : <Button variant="outline" onClick={() => setConfirm("leave")}>Quitter le groupe</Button>
        } />

      <div className="mb-6 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5"><Users className="size-4" /> {group.memberCount} / {group.maxMembers} membres</span>
        {group.courseTitle && group.courseId && <span className="flex items-center gap-1.5"><BookOpen className="size-4" /> <AppLink to={`/formations/${group.courseId}`} className="font-semibold text-primary hover:underline">{group.courseTitle}</AppLink></span>}
        {group.universityName && <span>{group.universityName}</span>}
        {group.ownerName && <span>Créé par {group.ownerName}</span>}
      </div>

      {!isMember ? (
        <InlineAlert tone="info">Rejoignez le groupe pour voir ses membres et ses séances, et recevoir les notifications.</InlineAlert>
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="seances">
            <h2 id="seances" className="mb-3 font-display text-lg font-bold">Séances à venir</h2>
            {sessions.isPending ? <div className="h-24 animate-pulse rounded-xl bg-foreground/10" /> : sessions.isError ? <ServerErrorScreen compact onRetry={() => void sessions.refetch()} /> : upcoming.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">{owner ? "Aucune séance programmée. Programmez la première pour que le groupe puisse s'organiser." : "Aucune séance programmée pour l'instant. Vous serez notifié dès que la propriétaire ou le propriétaire en ajoute une."}</p>
            ) : (
              <ul className="space-y-3">
                {upcoming.map((s) => <SessionCard key={s.id} session={s} owner={owner} names={names} busy={acts.rsvp.isPending} readOnly={false}
                  onRsvp={(status) => void run(() => acts.rsvp.mutateAsync({ sessionId: s.id, status }), status ? "Réponse enregistrée." : "Réponse retirée.")} onCancel={() => setConfirm({ kind: "cancel", session: s })} />)}
              </ul>
            )}
            {past.length > 0 && (
              <details className="mt-4 rounded-xl border border-border bg-card p-4">
                <summary className="cursor-pointer text-sm font-semibold">Séances passées ou annulées ({past.length})</summary>
                <ul className="mt-3 space-y-3">{past.map((s) => <SessionCard key={s.id} session={s} owner={false} names={names} busy readOnly onRsvp={() => undefined} onCancel={() => undefined} />)}</ul>
              </details>
            )}
          </section>

          <section aria-labelledby="membres">
            <h2 id="membres" className="mb-1 font-display text-lg font-bold">Membres</h2>
            {members.isPending ? <div className="h-20 animate-pulse rounded-xl bg-foreground/10" /> : members.isError ? <ServerErrorScreen compact onRetry={() => void members.refetch()} /> : (
              <ul className="divide-y divide-border">
                {members.data!.map((m) => <MemberRow key={m.userId} member={m} isSelf={m.userId === userId} canKick={owner && m.userId !== userId} onKick={() => setConfirm({ kind: "kick", member: m })} />)}
              </ul>
            )}
          </section>
        </div>
      )}

      <GroupFormDialog open={editing} onOpenChange={setEditing} group={group} />
      <SessionDialog open={planning} onOpenChange={setPlanning} groupId={group.id} />

      <ConfirmDialog open={confirm === "leave"} onOpenChange={(o) => !o && setConfirm(null)} title="Quitter ce groupe ?" description={leaveText} confirmLabel="Quitter" destructive
        onConfirm={() => void run(() => acts.leave.mutateAsync(group.id), "Vous avez quitté le groupe.", () => void navigate({ to: "/revision" }))} />
      <ConfirmDialog open={confirm === "archive"} onOpenChange={(o) => !o && setConfirm(null)} title="Archiver ce groupe ?" description="Le groupe disparaît de la liste et plus personne ne peut le rejoindre. Les membres gardent l'accès à son historique." confirmLabel="Archiver" destructive
        onConfirm={() => void run(() => acts.archive.mutateAsync(group.id), "Groupe archivé.", () => void navigate({ to: "/revision" }))} />
      <ConfirmDialog open={typeof confirm === "object" && confirm !== null && confirm.kind === "kick"} onOpenChange={(o) => !o && setConfirm(null)}
        title={typeof confirm === "object" && confirm !== null && confirm.kind === "kick" ? `Retirer ${confirm.member.name} ?` : ""} description="Cette personne perd l'accès au groupe. Elle pourra le rejoindre à nouveau s'il reste de la place." confirmLabel="Retirer" destructive
        onConfirm={() => { if (typeof confirm === "object" && confirm !== null && confirm.kind === "kick") void run(() => acts.kick.mutateAsync({ groupId: group.id, userId: confirm.member.userId }), "Membre retiré."); }} />
      <ConfirmDialog open={typeof confirm === "object" && confirm !== null && confirm.kind === "cancel"} onOpenChange={(o) => !o && setConfirm(null)}
        title="Annuler cette séance ?" description="Les membres seront prévenus de l'annulation." confirmLabel="Annuler la séance" destructive
        onConfirm={() => { if (typeof confirm === "object" && confirm !== null && confirm.kind === "cancel") void run(() => acts.cancelSession.mutateAsync(confirm.session.id), "Séance annulée."); }} />
    </div>
  );
}
