import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pill } from "@/components/cm/badges";
import { ConfirmDialog } from "@/components/cm/feedback";
import { EmptyScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { StateSwitcher } from "@/components/cm/state-switcher";
import { PageHeader } from "@/components/layout/PageHeader";
import { AppLink } from "@/components/cm/app-link";
import { CheckCircle, Eye, Flag, MoreVertical, RefreshCw, Search, Trash, X } from "@/components/icons";
import { products, formatFcfa } from "@/lib/mock-data";
import { reports as seedReports, type ReportStatus } from "@/lib/mock-admin";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_admin/admin/annonces/")({
  head: () => ({ meta: [{ title: "Annonces — Administration CampusMarket" }] }),
  component: AdminListingsPage,
});

type ListingStatus = "publiee" | "en_attente" | "retiree";
type Preview = "liste" | "recherche" | "aucun" | "vide" | "signalements" | "chargement" | "erreur";
const previews = [
  { id: "liste", label: "Annonces publiées" },
  { id: "recherche", label: "Recherche" },
  { id: "aucun", label: "Aucun résultat" },
  { id: "vide", label: "Aucune annonce" },
  { id: "signalements", label: "Signalements" },
  { id: "chargement", label: "Chargement" },
  { id: "erreur", label: "Erreur serveur" },
] as const satisfies readonly { id: Preview; label: string }[];

const statusLabel: Record<ListingStatus, string> = { publiee: "Publiée", en_attente: "En attente", retiree: "Retirée" };
const statusTone: Record<ListingStatus, "success" | "warning" | "danger"> = { publiee: "success", en_attente: "warning", retiree: "danger" };
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Quelques annonces de démonstration marquées « signalée » car liées à un signalement en attente. */
const flaggedIds = new Set(seedReports.filter((r) => r.kind === "annonce").map((r) => r.targetLabel));

function AdminListingsPage() {
  const [statuses, setStatuses] = useState<Record<string, ListingStatus>>({});
  const [reports, setReports] = useState(seedReports.filter((r) => r.kind === "annonce"));
  const [preview, setPreview] = useState<Preview>("liste");
  const [q, setQ] = useState("");
  const [toRemove, setToRemove] = useState<{ id: string; name: string } | null>(null);

  const applyPreview = (id: Preview) => { setPreview(id); if (id === "recherche") setQ("iphone"); if (id === "liste") setQ(""); };
  const statusOf = (id: string): ListingStatus => statuses[id] ?? (flaggedIds.has(products.find((p) => p.id === id)?.name ?? "") ? "en_attente" : "publiee");

  const qn = normalize(q);
  const results = useMemo(() => products.filter((p) => !qn || normalize(`${p.name} ${p.category} ${p.campus}`).includes(qn)), [qn]);

  const setStatus = (id: string, status: ListingStatus) => setStatuses((cur) => ({ ...cur, [id]: status }));
  const resolveReport = (id: string, status: ReportStatus) => setReports((cur) => cur.map((r) => (r.id === id ? { ...r, status } : r)));

  let body;
  if (preview === "chargement") body = <div aria-busy className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-foreground/10" />)}</div>;
  else if (preview === "erreur") body = <ServerErrorScreen compact onRetry={() => applyPreview("liste")} />;
  else if (preview === "vide") body = <EmptyScreen compact title="Aucune annonce" description="Les annonces publiées par les étudiants apparaîtront ici." />;
  else if (preview === "signalements") body = (
    reports.length === 0 ? <EmptyScreen compact title="Aucun signalement" description="Les signalements d'annonces apparaîtront ici." /> : (
      <div className="space-y-2">
        {reports.map((r) => (
          <div key={r.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive"><Flag className="size-5" /></span>
            <div className="min-w-0 flex-1"><p className="truncate font-semibold">{r.targetLabel}</p><p className="truncate text-xs text-muted-foreground">{r.reason} · signalé par {r.reporterName} · {r.createdLabel}</p></div>
            <Pill tone={r.status === "en_attente" ? "warning" : r.status === "traite" ? "success" : "neutral"}>{r.status === "en_attente" ? "En attente" : r.status === "traite" ? "Traité" : "Rejeté"}</Pill>
            {r.status === "en_attente" && <div className="flex gap-1.5"><Button size="sm" variant="outline" onClick={() => resolveReport(r.id, "traite")}><CheckCircle /> Traiter</Button><Button size="sm" variant="ghost" onClick={() => resolveReport(r.id, "rejete")}>Rejeter</Button></div>}
          </div>
        ))}
      </div>
    )
  );
  else if (preview === "aucun" || results.length === 0) body = <NoResultsScreen compact query={preview === "aucun" ? undefined : q} filtered={preview === "aucun"} />;
  else body = (
    <div className="space-y-2">
      {results.map((p) => {
        const status = statusOf(p.id);
        return (
          <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
            <span className={cn("grid size-11 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-primary", p.tone)}><p.icon className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{p.name}</p><Pill tone={statusTone[status]}>{statusLabel[status]}</Pill></div>
              <p className="truncate text-xs text-muted-foreground">{formatFcfa(p.price)} · {p.campus} · {p.category}</p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions pour ${p.name}`}><MoreVertical className="size-5" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild><AppLink to={`/produit/${p.id}`}><Eye /> Voir l'annonce</AppLink></DropdownMenuItem>
                {status !== "publiee" && <DropdownMenuItem onSelect={() => setStatus(p.id, "publiee")}><CheckCircle /> Approuver</DropdownMenuItem>}
                {status !== "en_attente" && status !== "retiree" && <DropdownMenuItem onSelect={() => setStatus(p.id, "en_attente")}><RefreshCw /> Mettre en attente</DropdownMenuItem>}
                <DropdownMenuSeparator />
                {status !== "retiree" && <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToRemove({ id: p.id, name: p.name })}><Trash /> Retirer l'annonce</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
    </div>
  );

  const pendingReports = reports.filter((r) => r.status === "en_attente").length;

  return (
    <div>
      <PageHeader kicker="Administration" title="Annonces" description="Modérez les annonces publiées et traitez les signalements." breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Annonces" }]} />
      <StateSwitcher states={previews} value={preview} onChange={applyPreview} />

      <div role="tablist" className="mb-5 inline-flex rounded-lg border border-border bg-secondary p-1">
        <button role="tab" aria-selected={preview !== "signalements"} onClick={() => setPreview("liste")} className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", preview !== "signalements" ? "bg-card shadow-soft" : "text-muted-foreground")}>Annonces</button>
        <button role="tab" aria-selected={preview === "signalements"} onClick={() => setPreview("signalements")} className={cn("flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold", preview === "signalements" ? "bg-card shadow-soft" : "text-muted-foreground")}><Flag className="size-4" /> Signalements {pendingReports > 0 && `(${pendingReports})`}</button>
      </div>

      {preview !== "signalements" && preview !== "chargement" && preview !== "erreur" && preview !== "vide" && (
        <div className="relative mb-4 max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une annonce, une catégorie, un campus…" aria-label="Rechercher une annonce" className="h-11 w-full rounded-lg border border-input bg-card pl-11 pr-9 text-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25" />
          {q && <button type="button" aria-label="Effacer" onClick={() => setQ("")} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button>}
        </div>
      )}

      {body}

      <ConfirmDialog open={!!toRemove} onOpenChange={(o) => !o && setToRemove(null)} title={`Retirer « ${toRemove?.name} » ?`} description="L'annonce ne sera plus visible sur le marketplace. Le vendeur en sera informé." confirmLabel="Retirer" destructive
        onConfirm={() => { if (toRemove) { setStatus(toRemove.id, "retiree"); toast.success("Annonce retirée"); } setToRemove(null); }} />
    </div>
  );
}
