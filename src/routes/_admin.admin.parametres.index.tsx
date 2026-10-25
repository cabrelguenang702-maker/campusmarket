import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, IconInput } from "@/components/cm/forms";
import { ConfirmDialog, InlineAlert } from "@/components/cm/feedback";
import { EmptyScreen, ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar } from "@/components/cm/commerce";
import { History, Mail, Plus, Sliders, Trash, Users, X } from "@/components/icons";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/domain";
import {
  INVITABLE_ROLES, ROLE_DESCRIPTION, ROLE_LABEL, describeAudit, topRole, useAuditFeed, useInvitations, useTeam, useTeamActions,
  type Invitation, type StaffRole, type TeamMember,
} from "@/lib/api/admin-team";
import { cn } from "@/lib/utils";

export type AdminSettingsSearch = { onglet?: "invitations" | "audit" | undefined };

export const Route = createFileRoute("/_admin/admin/parametres/")({
  validateSearch: (s: Record<string, unknown>): AdminSettingsSearch => ({ onglet: s["onglet"] === "invitations" || s["onglet"] === "audit" ? s["onglet"] : undefined }),
  head: () => ({ meta: [{ title: "Paramètres — Administration CampusMarket" }] }),
  component: AdminSettingsPage,
});

const skeleton = <div aria-busy className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-foreground/10" />)}</div>;
const stateLabel: Record<Invitation["state"], string> = { pending: "En attente", accepted: "Acceptée", revoked: "Révoquée", expired: "Expirée" };
const timeFmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function AdminSettingsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin") || roles.includes("super_admin");
  const tab = search.onglet ?? "equipe";
  const goTab = (t: "equipe" | "invitations" | "audit") => void navigate({ search: { onglet: t === "equipe" ? undefined : t }, replace: true });
  const tabs: { id: "equipe" | "invitations" | "audit"; label: string; icon: typeof Users }[] = [
    { id: "equipe", label: "Équipe & rôles", icon: Users }, { id: "invitations", label: "Invitations", icon: Mail }, { id: "audit", label: "Journal d'audit", icon: History },
  ];

  return (
    <div>
      <PageHeader kicker="Administration" title="Paramètres" description="Gérez l'équipe, les rôles et suivez les actions du personnel." breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Paramètres" }]} />
      {!isAdmin ? (
        <InlineAlert tone="info">Cette section est réservée aux administrateurs. La double authentification de votre compte se règle dans <Link to="/admin/securite" className="font-semibold underline">Sécurité</Link>.</InlineAlert>
      ) : (
        <>
          <div role="tablist" className="mb-6 inline-flex flex-wrap rounded-lg border border-border bg-secondary p-1">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => goTab(t.id)} className={cn("flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold", tab === t.id ? "bg-card shadow-soft" : "text-muted-foreground")}><t.icon className="size-4" /> {t.label}</button>
            ))}
          </div>
          {tab === "equipe" && <TeamTab />}
          {tab === "invitations" && <InvitationsTab />}
          {tab === "audit" && <AuditTab />}
        </>
      )}
    </div>
  );
}

function InviteDialog({ open, onOpenChange, canInviteAdmin }: { open: boolean; onOpenChange: (o: boolean) => void; canInviteAdmin: boolean }) {
  const acts = useTeamActions();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("support");
  const [error, setError] = useState<string | null>(null);
  const options = INVITABLE_ROLES.filter((r) => r !== "admin" || canInviteAdmin);

  const submit = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("Adresse e-mail non valide.");
    setError(null);
    try {
      await acts.invite.mutateAsync({ email: email.trim(), role });
      toast.success("Invitation créée. Prévenez la personne : elle l'accepte depuis ses notifications après s'être inscrite avec cette adresse.");
      setEmail(""); onOpenChange(false);
    } catch (e) { setError(acts.errorText(e, "Invitation impossible.")); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-display">Inviter un membre</DialogTitle><DialogDescription>Aucun e-mail n'est envoyé pour l'instant : la personne doit avoir (ou créer) un compte avec cette adresse, puis accepter l'invitation dans ses notifications. Valable 7 jours.</DialogDescription></DialogHeader>
        <Field label="Adresse e-mail" htmlFor="inv-email"><IconInput id="inv-email" icon={Mail} type="email" placeholder="prenom@exemple.com" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Rôle" htmlFor="inv-role">
          <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
            <SelectTrigger id="inv-role" className="h-11 bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>{options.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button><Button onClick={() => void submit()} disabled={acts.invite.isPending}>{acts.invite.isPending ? "Envoi…" : "Créer l'invitation"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamTab() {
  const { session, roles } = useAuth();
  const isSuper = roles.includes("super_admin");
  const team = useTeam();
  const acts = useTeamActions();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removal, setRemoval] = useState<{ member: TeamMember; role: StaffRole } | null>(null);

  const canManage = (role: StaffRole) => (role === "admin" || role === "super_admin" ? isSuper && role !== "super_admin" : true);
  const remove = async () => {
    if (!removal) return;
    try { await acts.revoke.mutateAsync({ userId: removal.member.userId, role: removal.role }); toast.success("Rôle retiré."); }
    catch (e) { toast.error(acts.errorText(e, "Retrait impossible.")); }
    setRemoval(null);
  };
  const add = async (member: TeamMember, role: StaffRole) => {
    try { await acts.grant.mutateAsync({ userId: member.userId, role }); toast.success("Rôle attribué."); }
    catch (e) { toast.error(acts.errorText(e, "Attribution impossible.")); }
  };

  if (team.isLoading) return skeleton;
  if (team.isError) return <ServerErrorScreen compact onRetry={() => void team.refetch()} />;
  const members = team.data ?? [];

  return (
    <div>
      <div className="mb-3 flex justify-end"><Button onClick={() => setInviteOpen(true)}><Plus /> Inviter un membre</Button></div>
      {members.length === 0 ? <EmptyScreen compact title="Aucun membre" description="Invitez la première personne de l'équipe." /> : (
        <div className="space-y-2">
          {members.map((m) => {
            const self = m.userId === session?.user.id;
            const addable = INVITABLE_ROLES.filter((r) => !m.roles.includes(r) && canManage(r));
            return (
              <div key={m.userId} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3.5">
                <Avatar name={m.name} size="md" />
                <div className="min-w-0 flex-1 basis-44">
                  <p className="font-semibold">{m.name}{self && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(vous)</span>}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.email} · depuis le {formatDate(m.since)}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {m.roles.map((r) => (
                      <span key={r} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold", r === topRole(m.roles) ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-secondary")}>
                        {ROLE_LABEL[r]}
                        {!(self && (r === "admin" || r === "super_admin")) && canManage(r) && r !== "super_admin" && (
                          <button aria-label={`Retirer le rôle ${ROLE_LABEL[r]} à ${m.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => setRemoval({ member: m, role: r })}><X className="size-3" /></button>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
                {!self && addable.length > 0 && (
                  <Select value="" onValueChange={(v) => void add(m, v as StaffRole)}>
                    <SelectTrigger className="h-9 w-full bg-background text-sm sm:w-48"><SelectValue placeholder="Ajouter un rôle" /></SelectTrigger>
                    <SelectContent>{addable.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-6 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        <p className="mb-2 flex items-center gap-2 font-semibold text-foreground"><Sliders className="size-4 text-primary" /> Rôles</p>
        <ul className="space-y-1">{(Object.keys(ROLE_LABEL) as StaffRole[]).map((r) => <li key={r}><strong className="text-foreground">{ROLE_LABEL[r]}</strong> — {ROLE_DESCRIPTION[r]}</li>)}</ul>
        <p className="mt-3">Nommer ou retirer un administrateur est réservé aux super-administrateurs. Toutes ces actions exigent une session sécurisée (<Link to="/admin/securite" className="font-semibold underline">double authentification</Link>).</p>
      </div>
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} canInviteAdmin={isSuper} />
      <ConfirmDialog open={!!removal} onOpenChange={(o) => !o && setRemoval(null)} destructive title={removal ? `Retirer « ${ROLE_LABEL[removal.role]} » à ${removal.member.name} ?` : ""}
        description="Les droits correspondants sont retirés immédiatement. Si c'était son dernier rôle, la personne redevient simple étudiante." confirmLabel="Retirer" onConfirm={remove} />
    </div>
  );
}

function InvitationsTab() {
  const query = useInvitations();
  const acts = useTeamActions();
  const [toRevoke, setToRevoke] = useState<Invitation | null>(null);
  const revoke = async () => {
    if (!toRevoke) return;
    try { await acts.revokeInvitation.mutateAsync(toRevoke.id); toast.success("Invitation révoquée."); }
    catch (e) { toast.error(acts.errorText(e, "Révocation impossible.")); }
    setToRevoke(null);
  };
  if (query.isLoading) return skeleton;
  if (query.isError) return <ServerErrorScreen compact onRetry={() => void query.refetch()} />;
  const rows = query.data ?? [];
  if (rows.length === 0) return <EmptyScreen compact title="Aucune invitation" description="Les invitations envoyées à l'équipe apparaîtront ici." />;
  return (
    <div>
      <ul className="space-y-2">
        {rows.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3.5">
            <div className="min-w-0 flex-1 basis-44">
              <p className="truncate font-semibold">{i.email}</p>
              <p className="text-xs text-muted-foreground">{ROLE_LABEL[i.role]} · invité par {i.invitedBy} le {formatDate(i.createdAt)}{i.state === "pending" ? ` · expire le ${formatDate(i.expiresAt)}` : ""}</p>
            </div>
            <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", i.state === "pending" ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-secondary text-muted-foreground")}>{stateLabel[i.state]}</span>
            {i.state === "pending" && <Button variant="ghost" size="icon" aria-label={`Révoquer l'invitation de ${i.email}`} onClick={() => setToRevoke(i)}><Trash className="size-5 text-destructive" /></Button>}
          </li>
        ))}
      </ul>
      <ConfirmDialog open={!!toRevoke} onOpenChange={(o) => !o && setToRevoke(null)} destructive title={`Révoquer l'invitation de ${toRevoke?.email ?? ""} ?`} description="Le lien d'invitation ne fonctionnera plus." confirmLabel="Révoquer" onConfirm={revoke} />
    </div>
  );
}

function AuditTab() {
  const feed = useAuditFeed();
  if (feed.isLoading) return skeleton;
  if (feed.isError) return <ServerErrorScreen compact onRetry={() => void feed.refetch()} />;
  const rows = feed.data?.pages.flat() ?? [];
  if (rows.length === 0) return <EmptyScreen compact title="Journal vide" description="Les actions du personnel sont enregistrées ici." />;
  return (
    <div>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {rows.map((a) => (
          <li key={a.id} className="flex items-start gap-3 px-4 py-3.5">
            <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", a.result === "success" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}><History className="size-4" /></span>
            <div className="min-w-0 flex-1"><p className="text-sm"><span className="font-semibold">{a.actor}</span> {describeAudit(a)}</p><p className="mt-0.5 text-xs text-muted-foreground">{timeFmt(a.at)}</p></div>
          </li>
        ))}
      </ul>
      {feed.hasNextPage && <div className="mt-4 flex justify-center"><Button variant="outline" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>{feed.isFetchingNextPage ? "Chargement…" : "Voir plus"}</Button></div>}
    </div>
  );
}
