import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/cm/feedback";
import { EmptyScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { StateSwitcher } from "@/components/cm/state-switcher";
import { PageHeader } from "@/components/layout/PageHeader";
import { UniversityFormDialog, type UniversityDraft } from "@/components/admin/UniversityFormDialog";
import { Buildings, MapPin, MoreVertical, Pencil, Plus, Search, Trash, Users, X } from "@/components/icons";
import { universities as seedUniversities, type University } from "@/lib/mock-data";
import { flagByCountry, countryName } from "@/lib/university-directory";

export const Route = createFileRoute("/_admin/admin/universites/")({
  head: () => ({ meta: [{ title: "Universités — Administration CampusMarket" }] }),
  component: AdminUniversitiesPage,
});

type Preview = "liste" | "recherche" | "aucun" | "vide" | "chargement" | "erreur";
const previews = [
  { id: "liste", label: "Liste" },
  { id: "recherche", label: "Recherche" },
  { id: "aucun", label: "Aucun résultat" },
  { id: "vide", label: "Aucune université" },
  { id: "chargement", label: "Chargement" },
  { id: "erreur", label: "Erreur serveur" },
] as const satisfies readonly { id: Preview; label: string }[];

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function AdminUniversitiesPage() {
  const [list, setList] = useState<University[]>(seedUniversities);
  const [preview, setPreview] = useState<Preview>("liste");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<University | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<University | null>(null);

  const applyPreview = (id: Preview) => { setPreview(id); if (id === "recherche") setQ("yaound"); if (id === "liste") setQ(""); };

  const qn = normalize(q);
  const results = list.filter((u) => !qn || normalize(`${u.name} ${u.short} ${u.city}`).includes(qn));

  const save = (draft: UniversityDraft) => {
    if (editing) { setList((cur) => cur.map((u) => (u.id === editing.id ? { ...u, ...draft } : u))); toast.success("Université mise à jour"); }
    else { setList((cur) => [...cur, { id: `u-${Date.now()}`, ...draft }]); toast.success("Université ajoutée à l'annuaire"); }
    setEditing(null);
  };

  let body;
  if (preview === "chargement") body = <div aria-busy className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-foreground/10" />)}</div>;
  else if (preview === "erreur") body = <ServerErrorScreen compact onRetry={() => applyPreview("liste")} />;
  else if (preview === "vide") body = <EmptyScreen compact title="Aucune université" description="Ajoutez votre première université partenaire." actions={<Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> Ajouter</Button>} />;
  else if (preview === "aucun" || results.length === 0) body = <NoResultsScreen compact query={preview === "aucun" ? undefined : q} filtered={preview === "aucun"} />;
  else body = (
    <div className="space-y-2">
      {results.map((u) => (
        <div key={u.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Buildings className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{u.name} <span className="font-normal text-muted-foreground">· {u.short}</span></p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 truncate text-xs text-muted-foreground"><span className="flex items-center gap-1"><MapPin className="size-3.5" />{u.city} · {flagByCountry[u.country]} {countryName(u.country)}</span><span className="flex items-center gap-1"><Users className="size-3.5" />{u.students}</span></p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions pour ${u.name}`}><MoreVertical className="size-5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => { setEditing(u); setFormOpen(true); }}><Pencil /> Modifier</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToDelete(u)}><Trash /> Retirer de l'annuaire</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <PageHeader kicker="Administration" title="Universités" description="Gérez les établissements partenaires visibles dans l'annuaire." breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Universités" }]}
        actions={<Button size="lg" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> Ajouter une université</Button>} />
      <StateSwitcher states={previews} value={preview} onChange={applyPreview} />

      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une université, un sigle, une ville…" aria-label="Rechercher une université" className="h-11 w-full rounded-lg border border-input bg-card pl-11 pr-9 text-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25" />
        {q && <button type="button" aria-label="Effacer" onClick={() => setQ("")} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button>}
      </div>

      <p className="mb-4 text-sm text-muted-foreground" aria-live="polite">{preview !== "aucun" && preview !== "vide" && <><span className="font-bold text-foreground">{results.length}</span> établissement{results.length > 1 ? "s" : ""}</>}</p>
      {body}

      <UniversityFormDialog open={formOpen} onOpenChange={setFormOpen} initial={editing} onSave={save} />
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} title={`Retirer ${toDelete?.name} ?`} description="L'université n'apparaîtra plus dans l'annuaire ni au moment de l'inscription des nouveaux étudiants." confirmLabel="Retirer" destructive
        onConfirm={() => { if (toDelete) { setList((cur) => cur.filter((u) => u.id !== toDelete.id)); toast.success("Université retirée"); } setToDelete(null); }} />
    </div>
  );
}
