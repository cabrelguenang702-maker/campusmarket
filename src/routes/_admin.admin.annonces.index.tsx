import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { EmptyScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { CheckCircle, ChevronLeft, ChevronRight, Eye, Flag, MoreVertical, RefreshCw, Search, Trash, X } from "@/components/icons";
import { categoryOf, formatDate, formatFcfa } from "@/lib/domain";
import {
  LISTINGS_PAGE_SIZE, moderationLabel, reportStatusLabel, reportTargetLabel, useAdminListings, useModerationActions, usePendingListingsCount, useReports,
  type AdminListing, type AdminReport, type ModerationStatus,
} from "@/lib/api/admin-listings";
import { cn } from "@/lib/utils";

type Tab = "validation" | "publiees" | "retirees" | "signalements";
export type AdminListingsSearch = { onglet?: Exclude<Tab, "validation"> | undefined };

export const Route = createFileRoute("/_admin/admin/annonces/")({
  validateSearch: (s: Record<string, unknown>): AdminListingsSearch => ({ onglet: (["publiees", "retirees", "signalements"] as const).find((v) => v === s["onglet"]) }),
  head: () => ({ meta: [{ title: "Annonces — Administration CampusMarket" }] }),
  component: AdminListingsPage,
});

const TABS: { id: Tab; label: string }[] = [{ id: "validation", label: "À valider" }, { id: "publiees", label: "Publiées" }, { id: "retirees", label: "Retirées" }, { id: "signalements", label: "Signalements" }];
const TAB_STATUS: Record<Exclude<Tab, "signalements">, ModerationStatus> = { validation: "pending_review", publiees: "published", retirees: "removed" };
const statusTone: Record<ModerationStatus, "warning" | "success" | "danger"> = { pending_review: "warning", published: "success", removed: "danger" };
const skeleton = <div aria-busy className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-foreground/10" />)}</div>;

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / LISTINGS_PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-center gap-3 text-sm">
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft className="size-4" /> Précédent</Button>
      <span className="text-muted-foreground">Page {page + 1} sur {pages}</span>
      <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Suivant <ChevronRight className="size-4" /></Button>
    </div>
  );
}

/** Motif (retrait, mise en attente) ou note (signalement) saisi avant l'action ; il est conservé dans le journal d'audit. */
function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, required, busy, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; confirmLabel: string; required: boolean; busy: boolean; onConfirm: (text: string) => void;
}) {
  const [text, setText] = useState("");
  useEffect(() => { if (open) setText(""); }, [open]);
  const valid = !required || text.trim().length >= 3;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display">{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <Textarea value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder={required ? "Motif (obligatoire)" : "Note (facultative)"} aria-label={required ? "Motif" : "Note"} className="min-h-24" />
        <div className="flex gap-2.5">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button className="flex-1" disabled={!valid || busy} onClick={() => onConfirm(text.trim())}>{busy ? "En cours…" : confirmLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AdminListingsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const tab: Tab = search.onglet ?? "validation";
  const pending = usePendingListingsCount();
  const goTab = (t: Tab) => void navigate({ search: { onglet: t === "validation" ? undefined : t } });
  return (
    <div>
      <PageHeader kicker="Administration" title="Annonces" description="Validez les nouvelles annonces, retirez celles qui posent problème et traitez les signalements." breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Annonces" }]} />
      <div role="tablist" className="no-scrollbar mb-5 inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-secondary p-1">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => goTab(t.id)} className={cn("shrink-0 rounded-md px-4 py-1.5 text-sm font-semibold", tab === t.id ? "bg-card shadow-soft" : "text-muted-foreground")}>
            {t.label}{t.id === "validation" && (pending.data ?? 0) > 0 ? ` (${pending.data})` : ""}
          </button>
        ))}
      </div>
      {tab === "signalements" ? <ReportsTab /> : <ListingsTab key={tab} status={TAB_STATUS[tab]} />}
    </div>
  );
}

type ListingAction = { listing: AdminListing; to: ModerationStatus; needsReason: boolean } | null;

function ListingsTab({ status }: { status: ModerationStatus }) {
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [action, setAction] = useState<ListingAction>(null);
  const acts = useModerationActions();
  useEffect(() => { const t = window.setTimeout(() => { setQ(qInput); setPage(0); }, 350); return () => window.clearTimeout(t); }, [qInput]);
  const list = useAdminListings({ status, search: q, page });
  const rows = list.data?.rows ?? [];
  const fail = (title: string) => (e: unknown) => toast.error(title, { description: acts.errorText(e) });

  const run = (listing: AdminListing, to: ModerationStatus, done: string, reason?: string) =>
    acts.setStatus.mutate({ productId: listing.id, status: to, ...(reason ? { reason } : {}) }, { onSuccess: () => { toast.success(done); setAction(null); }, onError: fail("Modération impossible") });

  let body;
  if (list.isPending) body = skeleton;
  else if (list.isError) body = <ServerErrorScreen compact onRetry={() => void list.refetch()} />;
  else if (rows.length === 0 && !q) body = <EmptyScreen compact title={status === "pending_review" ? "Aucune annonce à valider" : status === "removed" ? "Aucune annonce retirée" : "Aucune annonce publiée"} description={status === "pending_review" ? "Les nouvelles annonces des étudiants apparaîtront ici avant leur publication." : "Les annonces concernées apparaîtront ici."} />;
  else if (rows.length === 0) body = <NoResultsScreen compact query={q} />;
  else body = (
    <div className={cn("space-y-2", list.isPlaceholderData && "opacity-60 transition-opacity")}>
      {rows.map((p) => {
        const category = categoryOf(p.category);
        return (
          <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
            <span className={cn("grid size-11 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-primary", category.tone)}><category.icon className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{p.name}</p><Pill tone={statusTone[p.status]}>{moderationLabel[p.status]}</Pill></div>
              <p className="truncate text-xs text-muted-foreground">{formatFcfa(p.price)} · {p.campus} · {category.name} · {p.sellerName} · {formatDate(p.createdAt)}</p>
              {p.status === "removed" && p.moderationReason && <p className="mt-0.5 truncate text-xs text-destructive">Motif : {p.moderationReason}</p>}
            </div>
            {p.status === "pending_review" && <Button size="sm" className="hidden sm:inline-flex" disabled={acts.setStatus.isPending} onClick={() => run(p, "published", "Annonce publiée")}><CheckCircle /> Approuver</Button>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions pour ${p.name}`}><MoreVertical className="size-5" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild><AppLink to={`/produit/${p.id}`}><Eye /> Voir l'annonce</AppLink></DropdownMenuItem>
                {p.status === "pending_review" && <DropdownMenuItem onSelect={() => run(p, "published", "Annonce publiée")}><CheckCircle /> Approuver</DropdownMenuItem>}
                {p.status === "published" && <DropdownMenuItem onSelect={() => setAction({ listing: p, to: "pending_review", needsReason: true })}><RefreshCw /> Remettre en attente</DropdownMenuItem>}
                {p.status === "removed" && <DropdownMenuItem onSelect={() => run(p, "pending_review", "Annonce rétablie, en attente de validation")}><RefreshCw /> Rétablir (à revalider)</DropdownMenuItem>}
                {p.status !== "removed" && <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setAction({ listing: p, to: "removed", needsReason: true })}><Trash /> Retirer l'annonce</DropdownMenuItem></>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Rechercher une annonce…" aria-label="Rechercher une annonce" className="h-11 w-full rounded-lg border border-input bg-card pl-11 pr-9 text-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25" />
        {qInput && <button type="button" aria-label="Effacer" onClick={() => setQInput("")} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button>}
      </div>
      {body}
      <Pager page={page} total={list.data?.total ?? 0} onPage={setPage} />
      <ReasonDialog open={!!action} onOpenChange={(o) => !o && setAction(null)} required busy={acts.setStatus.isPending}
        title={action?.to === "removed" ? `Retirer « ${action.listing.name} » ?` : `Remettre « ${action?.listing.name ?? ""} » en attente ?`}
        description={action?.to === "removed" ? "L'annonce n'est plus visible des étudiants. Le motif est conservé avec l'annonce et dans le journal d'audit." : "L'annonce disparaît de la marketplace jusqu'à sa nouvelle validation. Le motif est conservé dans le journal d'audit."}
        confirmLabel={action?.to === "removed" ? "Retirer" : "Remettre en attente"} onConfirm={(reason) => action && run(action.listing, action.to, action.to === "removed" ? "Annonce retirée" : "Annonce remise en attente", reason)} />
    </div>
  );
}

type ReportAction = { report: AdminReport; to: "actioned" | "dismissed" } | null;

function ReportsTab() {
  const [open, setOpen] = useState(true);
  const [page, setPage] = useState(0);
  const [action, setAction] = useState<ReportAction>(null);
  const acts = useModerationActions();
  const list = useReports({ open, page });
  const rows = list.data?.rows ?? [];
  const fail = (title: string) => (e: unknown) => toast.error(title, { description: acts.errorText(e) });

  const startReview = (r: AdminReport) => acts.handleReport.mutate({ reportId: r.id, status: "reviewing" }, { onSuccess: () => toast.success("Signalement pris en charge"), onError: fail("Action impossible") });
  const close = (note: string) => {
    if (!action) return;
    acts.handleReport.mutate({ reportId: action.report.id, status: action.to, ...(note ? { note } : {}) }, {
      onSuccess: () => { toast.success(action.to === "actioned" ? "Signalement traité" : "Signalement rejeté"); setAction(null); },
      onError: fail("Action impossible"),
    });
  };
  const link = (r: AdminReport) => (r.targetType === "product" ? `/produit/${r.targetId}` : null);

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border border-border bg-secondary p-1" role="group" aria-label="Signalements">
        <button aria-pressed={open} onClick={() => { setOpen(true); setPage(0); }} className={cn("rounded-md px-3.5 py-1.5 text-sm font-semibold", open ? "bg-card shadow-soft" : "text-muted-foreground")}>À traiter</button>
        <button aria-pressed={!open} onClick={() => { setOpen(false); setPage(0); }} className={cn("rounded-md px-3.5 py-1.5 text-sm font-semibold", !open ? "bg-card shadow-soft" : "text-muted-foreground")}>Clos</button>
      </div>
      {list.isPending ? skeleton : list.isError ? <ServerErrorScreen compact onRetry={() => void list.refetch()} /> : rows.length === 0 ? (
        <EmptyScreen compact title={open ? "Aucun signalement à traiter" : "Aucun signalement clos"} description="Les signalements d'annonces, de profils, de messages et d'espaces apparaîtront ici." />
      ) : (
        <div className={cn("space-y-2", list.isPlaceholderData && "opacity-60 transition-opacity")}>
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive"><Flag className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{r.targetLabel}</p><Pill tone="neutral">{reportTargetLabel[r.targetType]}</Pill><Pill tone={r.status === "pending" ? "warning" : r.status === "reviewing" ? "primary" : r.status === "actioned" ? "success" : "neutral"}>{reportStatusLabel[r.status]}</Pill></div>
                  <p className="text-xs text-muted-foreground">{r.reason} · signalé par {r.reporterName} · {formatDate(r.createdAt)}</p>
                  {r.details && <p className="mt-1 text-sm">{r.details}</p>}
                  {(r.status === "actioned" || r.status === "dismissed") && <p className="mt-1 text-xs text-muted-foreground">Traité par {r.handledBy ?? "un membre du personnel"}{r.note ? ` : ${r.note}` : ""}</p>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-1.5">
                {link(r) && <Button size="sm" variant="ghost" asChild><AppLink to={link(r)!}><Eye /> Voir</AppLink></Button>}
                {r.status === "pending" && <Button size="sm" variant="outline" disabled={acts.handleReport.isPending} onClick={() => startReview(r)}>Prendre en charge</Button>}
                {(r.status === "pending" || r.status === "reviewing") && <>
                  <Button size="sm" variant="ghost" onClick={() => setAction({ report: r, to: "dismissed" })}>Rejeter</Button>
                  <Button size="sm" onClick={() => setAction({ report: r, to: "actioned" })}><CheckCircle /> Traiter</Button>
                </>}
              </div>
            </div>
          ))}
        </div>
      )}
      <Pager page={page} total={list.data?.total ?? 0} onPage={setPage} />
      <ReasonDialog open={!!action} onOpenChange={(o) => !o && setAction(null)} required={false} busy={acts.handleReport.isPending}
        title={action?.to === "actioned" ? "Marquer comme traité ?" : "Rejeter ce signalement ?"}
        description={action?.to === "actioned" ? "Marquer le signalement comme traité ne retire pas le contenu : retirez l'annonce ou suspendez le compte depuis leurs écrans si nécessaire." : "Le signalement est clos sans suite."}
        confirmLabel={action?.to === "actioned" ? "Traité" : "Rejeter"} onConfirm={close} />
    </div>
  );
}
