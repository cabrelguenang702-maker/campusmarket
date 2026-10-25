import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, IconInput } from "@/components/cm/forms";
import { Pill } from "@/components/cm/badges";
import { ConfirmDialog } from "@/components/cm/feedback";
import { EmptyScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { UniversityFormDialog } from "@/components/admin/UniversityFormDialog";
import { Buildings, MapPin, MoreVertical, Pencil, Plus, RefreshCw, Search, Tag, Trash, Users, X } from "@/components/icons";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/domain";
import { useAdminCountries, useAdminUniversities, useGeoActions, usePendingSuggestions, type AdminCountry, type AdminUniversity, type Suggestion } from "@/lib/api/admin-geo";
import { cn } from "@/lib/utils";

export type AdminUniversitiesSearch = { onglet?: "suggestions" | undefined };

export const Route = createFileRoute("/_admin/admin/universites/")({
  validateSearch: (s: Record<string, unknown>): AdminUniversitiesSearch => ({ onglet: s["onglet"] === "suggestions" ? "suggestions" : undefined }),
  head: () => ({ meta: [{ title: "Universités — Administration CampusMarket" }] }),
  component: AdminUniversitiesPage,
});

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
type StatusFilter = "toutes" | "actives" | "desactivees";
const skeleton = <div aria-busy className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-foreground/10" />)}</div>;

function AdminUniversitiesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin") || roles.includes("super_admin");
  const countries = useAdminCountries();
  const universities = useAdminUniversities();
  const suggestions = usePendingSuggestions();
  const tab = search.onglet === "suggestions" ? "suggestions" : "universites";
  const pending = suggestions.data?.length ?? 0;
  const goTab = (t: "universites" | "suggestions") => void navigate({ search: { onglet: t === "suggestions" ? "suggestions" : undefined } });

  return (
    <div>
      <PageHeader kicker="Administration" title="Universités" description="Gérez les établissements visibles dans l'annuaire et traitez les suggestions des étudiants." breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Universités" }]} />
      <div role="tablist" className="mb-5 inline-flex rounded-lg border border-border bg-secondary p-1">
        <button role="tab" aria-selected={tab === "universites"} onClick={() => goTab("universites")} className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", tab === "universites" ? "bg-card shadow-soft" : "text-muted-foreground")}>Universités</button>
        <button role="tab" aria-selected={tab === "suggestions"} onClick={() => goTab("suggestions")} className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", tab === "suggestions" ? "bg-card shadow-soft" : "text-muted-foreground")}>Suggestions{pending > 0 ? ` (${pending})` : ""}</button>
      </div>
      {!isAdmin && <p className="mb-4 rounded-lg border border-border bg-secondary px-3.5 py-2.5 text-sm text-muted-foreground">Lecture seule : seuls les administrateurs modifient l'annuaire.</p>}
      {tab === "universites"
        ? <UniversitiesTab isAdmin={isAdmin} countries={countries.data ?? []} query={universities} />
        : <SuggestionsTab isAdmin={isAdmin} countries={countries.data ?? []} query={suggestions} />}
    </div>
  );
}

function UniversitiesTab({ isAdmin, countries, query }: { isAdmin: boolean; countries: AdminCountry[]; query: ReturnType<typeof useAdminUniversities> }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("toutes");
  const [editing, setEditing] = useState<AdminUniversity | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<AdminUniversity | null>(null);
  const acts = useGeoActions();
  const countryOf = (code: string) => countries.find((c) => c.code === code);

  const qn = normalize(q);
  const all = query.data ?? [];
  const results = all.filter((u) => (status === "toutes" || (status === "actives" ? u.active : !u.active)) && (!qn || normalize(`${u.name} ${u.shortName} ${u.city}`).includes(qn)));
  const fail = (title: string) => (e: unknown) => toast.error(title, { description: acts.errorText(e) });

  const save = (draft: Parameters<typeof acts.saveUniversity.mutate>[0]["draft"]) =>
    acts.saveUniversity.mutate({ draft, id: editing?.id }, { onSuccess: () => { toast.success(editing ? "Université mise à jour" : "Université ajoutée à l'annuaire"); setFormOpen(false); setEditing(null); }, onError: fail("Enregistrement impossible") });
  const toggle = (u: AdminUniversity) => acts.setActive.mutate({ id: u.id, active: !u.active }, { onSuccess: () => toast.success(u.active ? "Université désactivée : elle n'est plus proposée à l'inscription" : "Université réactivée"), onError: fail("Modification impossible") });
  const remove = () => {
    if (!toDelete) return;
    acts.deleteUniversity.mutate(toDelete.id, { onSuccess: () => { toast.success("Université supprimée"); setToDelete(null); }, onError: (e) => { setToDelete(null); fail("Suppression impossible")(e); } });
  };

  let body;
  if (query.isPending) body = skeleton;
  else if (query.isError) body = <ServerErrorScreen compact onRetry={() => void query.refetch()} />;
  else if (all.length === 0) body = <EmptyScreen compact title="Aucune université" description="Ajoutez la première université partenaire." actions={isAdmin ? <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> Ajouter</Button> : undefined} />;
  else if (results.length === 0) body = <NoResultsScreen compact query={q || undefined} filtered={status !== "toutes"} />;
  else body = (
    <div className="space-y-2">
      {results.map((u) => {
        const c = countryOf(u.countryCode);
        return (
          <div key={u.id} className={cn("flex items-center gap-3 rounded-xl border border-border bg-card p-3.5", !u.active && "opacity-70")}>
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Buildings className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{u.name} <span className="font-normal text-muted-foreground">· {u.shortName}</span></p>{!u.active && <Pill tone="neutral">Désactivée</Pill>}</div>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 truncate text-xs text-muted-foreground"><span className="flex items-center gap-1"><MapPin className="size-3.5" />{u.city} · {c?.flag ?? "🌍"} {c?.name ?? u.countryCode}</span>{u.students !== null && <span className="flex items-center gap-1"><Users className="size-3.5" />{u.students.toLocaleString("fr-FR")}</span>}</p>
            </div>
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions pour ${u.name}`}><MoreVertical className="size-5" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => { setEditing(u); setFormOpen(true); }}><Pencil /> Modifier</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => toggle(u)}><RefreshCw /> {u.active ? "Désactiver" : "Réactiver"}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToDelete(u)}><Trash /> Supprimer</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une université, un sigle, une ville…" aria-label="Rechercher une université" className="h-11 w-full rounded-lg border border-input bg-card pl-11 pr-9 text-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25" />
          {q && <button type="button" aria-label="Effacer" onClick={() => setQ("")} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button>}
        </div>
        {(["toutes", "actives", "desactivees"] as const).map((s) => <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)} className={cn("rounded-full border px-3.5 py-2 text-sm font-semibold transition", status === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{s === "toutes" ? "Toutes" : s === "actives" ? "Actives" : "Désactivées"}</button>)}
        {isAdmin && <Button className="ml-auto" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> Ajouter une université</Button>}
      </div>
      <p className="mb-4 text-sm text-muted-foreground" aria-live="polite">{query.data && all.length > 0 && <><span className="font-bold text-foreground">{results.length}</span> établissement{results.length > 1 ? "s" : ""}</>}</p>
      {body}

      <UniversityFormDialog open={formOpen} onOpenChange={(o) => { setFormOpen(o); if (!o) setEditing(null); }} initial={editing} countries={countries} busy={acts.saveUniversity.isPending} onSave={save} />
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} destructive title={`Supprimer ${toDelete?.name ?? ""} ?`}
        description="Suppression définitive. Si des étudiants y sont rattachés, la base la refuse : désactivez-la plutôt, elle ne sera plus proposée à l'inscription." confirmLabel="Supprimer" onConfirm={remove} />
    </div>
  );
}

function SuggestionsTab({ isAdmin, countries, query }: { isAdmin: boolean; countries: AdminCountry[]; query: ReturnType<typeof usePendingSuggestions> }) {
  const [approving, setApproving] = useState<Suggestion | null>(null);
  const [rejecting, setRejecting] = useState<Suggestion | null>(null);
  const [short, setShort] = useState("");
  const [students, setStudents] = useState("");
  const acts = useGeoActions();
  useEffect(() => { if (approving) { setShort(""); setStudents(""); } }, [approving]);
  const rows = query.data ?? [];
  const fail = (title: string) => (e: unknown) => toast.error(title, { description: acts.errorText(e) });

  const approve = () => {
    if (!approving) return;
    acts.review.mutate({ id: approving.id, approve: true, shortName: short, students }, { onSuccess: () => { toast.success("Université ajoutée, la personne est prévenue"); setApproving(null); }, onError: fail("Approbation impossible") });
  };
  const reject = () => {
    if (!rejecting) return;
    acts.review.mutate({ id: rejecting.id, approve: false }, { onSuccess: () => { toast.success("Suggestion refusée, la personne est prévenue"); setRejecting(null); }, onError: (e) => { setRejecting(null); fail("Refus impossible")(e); } });
  };

  if (query.isPending) return skeleton;
  if (query.isError) return <ServerErrorScreen compact onRetry={() => void query.refetch()} />;
  if (rows.length === 0) return <EmptyScreen compact title="Aucune suggestion en attente" description="Les universités proposées par les étudiants apparaîtront ici." />;
  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground"><span className="font-bold text-foreground">{rows.length}</span> suggestion{rows.length > 1 ? "s" : ""} en attente, les plus anciennes d'abord.</p>
      <div className="space-y-2">
        {rows.map((s) => {
          const c = countries.find((x) => x.code === s.countryCode);
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3.5">
              <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Buildings className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{s.name}</p>
                <p className="text-xs text-muted-foreground">{s.city} · {c?.flag ?? "🌍"} {c?.name ?? s.countryCode} · suggérée par {s.suggesterName} · {formatDate(s.createdAt)}</p>
                {s.note && <p className="mt-1 text-sm">{s.note}</p>}
              </div>
              {isAdmin && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={acts.review.isPending} onClick={() => setRejecting(s)}>Refuser</Button><Button size="sm" disabled={acts.review.isPending} onClick={() => setApproving(s)}>Approuver</Button></div>}
            </div>
          );
        })}
      </div>

      <Dialog open={!!approving} onOpenChange={(o) => !o && setApproving(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display">Ajouter {approving?.name} ?</DialogTitle><DialogDescription>L'université rejoint l'annuaire et la personne qui l'a suggérée est prévenue. Le sigle doit être unique dans le pays.</DialogDescription></DialogHeader>
          <Field label="Sigle" htmlFor="sg-short"><IconInput id="sg-short" icon={Tag} maxLength={20} placeholder="Ex. UDO" value={short} onChange={(e) => setShort(e.target.value)} /></Field>
          <Field label="Étudiants (approx., facultatif)" htmlFor="sg-students"><IconInput id="sg-students" icon={Users} inputMode="numeric" placeholder="Ex. 20000" value={students} onChange={(e) => setStudents(e.target.value.replace(/\D/g, ""))} /></Field>
          <DialogFooter><Button variant="outline" onClick={() => setApproving(null)}>Annuler</Button><Button disabled={short.trim().length < 2 || acts.review.isPending} onClick={approve}>{acts.review.isPending ? "En cours…" : "Ajouter à l'annuaire"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)} destructive title={`Refuser « ${rejecting?.name ?? ""} » ?`} description="La suggestion est close sans suite et la personne est prévenue." confirmLabel="Refuser" onConfirm={reject} />
    </div>
  );
}
