import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "@/components/cm/commerce";
import { Pill } from "@/components/cm/badges";
import { EmptyScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { BadgeCheck, Block, ChevronLeft, ChevronRight, Flag, MoreVertical, Paperclip, RefreshCw, Search, Shield, UserX, X } from "@/components/icons";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/domain";
import {
  USERS_PAGE_SIZE, documentLabel, signedDocumentUrl, useAdminUserActions, useAdminUsers, usePendingVerifications, userStatusLabel,
  type AdminUser, type AdminUserStatus, type VerificationRequest,
} from "@/lib/api/admin-users";
import { cn } from "@/lib/utils";

export type AdminUsersSearch = { q?: string | undefined; statut?: AdminUserStatus | undefined; onglet?: "verifications" | undefined };

export const Route = createFileRoute("/_admin/admin/utilisateurs/")({
  validateSearch: (s: Record<string, unknown>): AdminUsersSearch => ({
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    statut: (["active", "suspended", "banned"] as const).find((v) => v === s["statut"]),
    onglet: s["onglet"] === "verifications" ? "verifications" : undefined,
  }),
  head: () => ({ meta: [{ title: "Utilisateurs — Administration CampusMarket" }] }),
  component: AdminUsersPage,
});

const statusTone: Record<AdminUserStatus, "success" | "warning" | "danger"> = { active: "success", suspended: "warning", banned: "danger" };
const skeleton = <div aria-busy className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-foreground/10" />)}</div>;

/** Motif obligatoire (3 à 500 caractères) pour suspendre, bannir ou refuser : il est conservé dans le journal d'audit. */
function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, busy, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; confirmLabel: string; busy: boolean; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  const valid = reason.trim().length >= 3;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display">{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <Textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Motif (obligatoire)" aria-label="Motif" className="min-h-24" />
        <div className="flex gap-2.5">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button variant="destructive" className="flex-1" disabled={!valid || busy} onClick={() => onConfirm(reason.trim())}>{busy ? "En cours…" : confirmLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-center gap-3 text-sm">
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft className="size-4" /> Précédent</Button>
      <span className="text-muted-foreground">Page {page + 1} sur {pages}</span>
      <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Suivant <ChevronRight className="size-4" /></Button>
    </div>
  );
}

type Action = { user: AdminUser; kind: "suspend" | "ban" | "reactivate" } | null;

function AdminUsersPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin") || roles.includes("super_admin");
  const setSearch = (patch: Partial<AdminUsersSearch>) => void navigate({ search: (prev) => ({ ...prev, ...patch }) });
  const tab = search.onglet === "verifications" ? "verifications" : "comptes";
  const verifs = usePendingVerifications(0);
  const pendingCount = verifs.data?.total ?? 0;

  return (
    <div>
      <PageHeader kicker="Administration" title="Utilisateurs" description="Recherchez, vérifiez et modérez les comptes étudiants." breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Utilisateurs" }]} />
      <div role="tablist" className="mb-5 inline-flex rounded-lg border border-border bg-secondary p-1">
        <button role="tab" aria-selected={tab === "comptes"} onClick={() => setSearch({ onglet: undefined })} className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", tab === "comptes" ? "bg-card shadow-soft" : "text-muted-foreground")}>Comptes</button>
        <button role="tab" aria-selected={tab === "verifications"} onClick={() => setSearch({ onglet: "verifications" })} className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", tab === "verifications" ? "bg-card shadow-soft" : "text-muted-foreground")}>Vérifications{pendingCount > 0 ? ` (${pendingCount})` : ""}</button>
      </div>
      {tab === "comptes" ? <AccountsTab isAdmin={isAdmin} search={search} setSearch={setSearch} /> : <VerificationsTab />}
    </div>
  );
}

function AccountsTab({ isAdmin, search, setSearch }: { isAdmin: boolean; search: AdminUsersSearch; setSearch: (p: Partial<AdminUsersSearch>) => void }) {
  const [qInput, setQInput] = useState(search.q ?? "");
  const [q, setQ] = useState(search.q ?? "");
  const [page, setPage] = useState(0);
  const [action, setAction] = useState<Action>(null);
  const acts = useAdminUserActions();
  useEffect(() => { const t = window.setTimeout(() => { setQ(qInput); setPage(0); }, 350); return () => window.clearTimeout(t); }, [qInput]);

  const list = useAdminUsers({ search: q, status: search.statut, page });
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const fail = (title: string) => (e: unknown) => toast.error(title, { description: acts.errorText(e) });

  const verify = (u: AdminUser) => acts.verify.mutate({ userId: u.id }, { onSuccess: () => toast.success(`${u.name} est maintenant vérifié·e`), onError: fail("Vérification impossible") });
  const reactivate = (u: AdminUser) => acts.reactivate.mutate({ userId: u.id }, { onSuccess: () => toast.success(`${u.name} a été réactivé·e`), onError: fail("Réactivation impossible") });
  const submitReason = (reason: string) => {
    if (!action) return;
    const { user, kind } = action;
    const run = kind === "ban" ? acts.ban : acts.suspend;
    run.mutate({ userId: user.id, reason }, {
      onSuccess: () => { toast.success(kind === "ban" ? `${user.name} a été banni·e` : `${user.name} a été suspendu·e`); setAction(null); },
      onError: fail(kind === "ban" ? "Bannissement impossible" : "Suspension impossible"),
    });
  };

  let body;
  if (list.isPending) body = skeleton;
  else if (list.isError) body = <ServerErrorScreen compact onRetry={() => void list.refetch()} />;
  else if (rows.length === 0 && !q && !search.statut) body = <EmptyScreen compact title="Aucun utilisateur" description="Les étudiants inscrits apparaîtront ici." />;
  else if (rows.length === 0) body = <NoResultsScreen compact query={q || undefined} filtered={!!search.statut} />;
  else body = (
    <div className="space-y-2">
      {rows.map((u) => (
        <div key={u.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
          <Avatar name={u.name} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{u.name}</p>{u.verified && <BadgeCheck className="size-4 text-primary" aria-label="Compte vérifié" />}<Pill tone={statusTone[u.status]}>{userStatusLabel[u.status]}</Pill>{u.reportsCount > 0 && <Pill tone="danger"><Flag className="size-3" />{u.reportsCount}</Pill>}</div>
            <p className="truncate text-xs text-muted-foreground">{u.email} · {u.campus} · {u.listingsCount} annonce{u.listingsCount > 1 ? "s" : ""} · inscrit le {formatDate(u.joinedAt)}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions pour ${u.name}`}><MoreVertical className="size-5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isAdmin && !u.verified && <DropdownMenuItem onSelect={() => verify(u)}><Shield /> Vérifier le compte</DropdownMenuItem>}
              {u.status === "suspended" && <DropdownMenuItem onSelect={() => reactivate(u)}><RefreshCw /> Réactiver</DropdownMenuItem>}
              {u.status === "banned" && isAdmin && <DropdownMenuItem onSelect={() => reactivate(u)}><RefreshCw /> Lever le bannissement</DropdownMenuItem>}
              {u.status === "active" && <DropdownMenuItem onSelect={() => setAction({ user: u, kind: "suspend" })}><UserX /> Suspendre</DropdownMenuItem>}
              {isAdmin && u.status !== "banned" && <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setAction({ user: u, kind: "ban" })}><Block /> Bannir définitivement</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Rechercher un nom ou un email…" aria-label="Rechercher un utilisateur" className="h-11 w-full rounded-lg border border-input bg-card pl-11 pr-9 text-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25" />
          {qInput && <button type="button" aria-label="Effacer" onClick={() => setQInput("")} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button>}
        </div>
        <div className="flex gap-2">
          {(["active", "suspended", "banned"] as const).map((s) => (
            <button key={s} aria-pressed={search.statut === s} onClick={() => { setPage(0); setSearch({ statut: search.statut === s ? undefined : s }); }} className={cn("rounded-full border px-3.5 py-2 text-sm font-semibold transition", search.statut === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{userStatusLabel[s]}</button>
          ))}
        </div>
      </div>
      <p className="mb-4 mt-4 text-sm text-muted-foreground" aria-live="polite">{list.data && total > 0 && <><span className="font-bold text-foreground">{total}</span> utilisateur{total > 1 ? "s" : ""}</>}</p>
      <div className={cn(list.isPlaceholderData && "opacity-60 transition-opacity")}>{body}</div>
      <Pager page={page} total={total} onPage={setPage} />

      <ReasonDialog open={!!action && action.kind !== "reactivate"} onOpenChange={(o) => !o && setAction(null)} busy={acts.ban.isPending || acts.suspend.isPending}
        title={action?.kind === "ban" ? `Bannir ${action.user.name} ?` : `Suspendre ${action?.user.name ?? ""} ?`}
        description={action?.kind === "ban" ? "Le compte perd tout accès et ses sessions sont fermées. Seul un administrateur peut lever un bannissement. Le motif est conservé dans le journal d'audit." : "Le compte est restreint tant qu'il est suspendu et l'étudiant est prévenu. Le motif est conservé dans le journal d'audit."}
        confirmLabel={action?.kind === "ban" ? "Bannir" : "Suspendre"} onConfirm={submitReason} />
    </div>
  );
}

function VerificationsTab() {
  const [page, setPage] = useState(0);
  const list = usePendingVerifications(page);
  const acts = useAdminUserActions();
  const [rejecting, setRejecting] = useState<VerificationRequest | null>(null);
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const fail = (title: string) => (e: unknown) => toast.error(title, { description: acts.errorText(e) });

  const openDoc = async (path: string) => {
    try { window.open(await signedDocumentUrl(path), "_blank", "noopener,noreferrer"); }
    catch (e) { toast.error("Document indisponible", { description: acts.errorText(e) }); }
  };
  const approve = (r: VerificationRequest) => acts.review.mutate({ requestId: r.id, approve: true }, { onSuccess: () => toast.success(`${r.name} est maintenant vérifié·e`), onError: fail("Approbation impossible") });
  const reject = (reason: string) => {
    if (!rejecting) return;
    const r = rejecting;
    acts.review.mutate({ requestId: r.id, approve: false, reason }, { onSuccess: () => { toast.success("Demande refusée, l'étudiant est prévenu"); setRejecting(null); }, onError: fail("Refus impossible") });
  };

  if (list.isPending) return skeleton;
  if (list.isError) return <ServerErrorScreen compact onRetry={() => void list.refetch()} />;
  if (rows.length === 0) return <EmptyScreen compact title="Aucune vérification en attente" description="Les demandes de vérification envoyées par les étudiants apparaîtront ici." />;
  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground"><span className="font-bold text-foreground">{total}</span> demande{total > 1 ? "s" : ""} en attente, les plus anciennes d'abord.</p>
      <div className={cn("space-y-2", list.isPlaceholderData && "opacity-60 transition-opacity")}>
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3.5">
            <Avatar name={r.name} size="md" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{r.name}</p>
              <p className="text-xs text-muted-foreground">{documentLabel[r.documentType]} · envoyé le {formatDate(r.createdAt)}</p>
              <div className="mt-1.5 flex flex-wrap gap-3">{r.paths.map((p, i) => <button key={p} onClick={() => void openDoc(p)} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><Paperclip className="size-3.5" /> {r.paths.length > 1 ? (i === 0 ? "Recto" : "Verso") : "Voir le document"}</button>)}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={acts.review.isPending} onClick={() => setRejecting(r)}>Refuser</Button>
              <Button size="sm" disabled={acts.review.isPending} onClick={() => approve(r)}>Approuver</Button>
            </div>
          </div>
        ))}
      </div>
      <Pager page={page} total={total} onPage={setPage} />
      <ReasonDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)} busy={acts.review.isPending} title={`Refuser la demande de ${rejecting?.name ?? ""} ?`}
        description="Le motif est montré à l'étudiant, qui pourra refaire une demande avec un document lisible." confirmLabel="Refuser" onConfirm={reject} />
    </div>
  );
}
