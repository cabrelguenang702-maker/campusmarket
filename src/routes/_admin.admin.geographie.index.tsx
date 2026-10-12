import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, IconInput } from "@/components/cm/forms";
import { ConfirmDialog } from "@/components/cm/feedback";
import { EmptyScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { StateSwitcher } from "@/components/cm/state-switcher";
import { PageHeader } from "@/components/layout/PageHeader";
import { Buildings, Globe2, MapPin, MoreVertical, Pencil, Phone, Plus, Search, Tag, Trash, X } from "@/components/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { countries as seedCountries, universities, type Country } from "@/lib/mock-data";
import { regions, regionsByCountry, flagByCountry } from "@/lib/university-directory";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_admin/admin/geographie/")({
  head: () => ({ meta: [{ title: "Géographie — Administration CampusMarket" }] }),
  component: AdminGeographyPage,
});

type Preview = "pays" | "recherche" | "aucun" | "villes" | "chargement" | "erreur";
const previews = [
  { id: "pays", label: "Pays" },
  { id: "recherche", label: "Recherche" },
  { id: "aucun", label: "Aucun résultat" },
  { id: "villes", label: "Villes" },
  { id: "chargement", label: "Chargement" },
  { id: "erreur", label: "Erreur serveur" },
] as const satisfies readonly { id: Preview; label: string }[];

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
type Draft = { name: string; code: string; dial: string; region: string };
const emptyDraft: Draft = { name: "", code: "", dial: "+", region: regions[0] ?? "" };

function AdminGeographyPage() {
  const [list, setList] = useState<Country[]>(seedCountries);
  const [regionOf, setRegionOf] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview>("pays");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Country | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [toDelete, setToDelete] = useState<Country | null>(null);

  const applyPreview = (id: Preview) => { setPreview(id); if (id === "recherche") setQ("cameroun"); if (id === "pays") setQ(""); };
  const regionFor = (code: string) => regionOf[code] ?? regionsByCountry[code] ?? regions[0] ?? "";
  const universityCount = (code: string) => universities.filter((u) => u.country === code).length;

  const openForm = (c: Country | null) => { setEditing(c); setDraft(c ? { name: c.name, code: c.code, dial: c.dial, region: regionFor(c.code) } : emptyDraft); setFormOpen(true); };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const valid = draft.name.trim().length > 1 && draft.code.trim().length === 2;

  const save = () => {
    if (editing) { setList((cur) => cur.map((c) => (c.code === editing.code ? { ...c, name: draft.name, dial: draft.dial } : c))); setRegionOf((cur) => ({ ...cur, [editing.code]: draft.region })); toast.success("Pays mis à jour"); }
    else { setList((cur) => [...cur, { code: draft.code.toUpperCase(), name: draft.name, dial: draft.dial, mobileMoney: [] }]); setRegionOf((cur) => ({ ...cur, [draft.code.toUpperCase()]: draft.region })); toast.success("Pays ajouté"); }
    setFormOpen(false);
  };

  const qn = normalize(q);
  const results = list.filter((c) => !qn || normalize(`${c.name} ${c.code}`).includes(qn));

  const cities = Array.from(new Set(universities.map((u) => u.city))).sort().map((city) => {
    const u = universities.find((x) => x.city === city)!;
    return { city, country: u.country, count: universities.filter((x) => x.city === city).length };
  });

  let body;
  if (preview === "chargement") body = <div aria-busy className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-foreground/10" />)}</div>;
  else if (preview === "erreur") body = <ServerErrorScreen compact onRetry={() => applyPreview("pays")} />;
  else if (preview === "villes") body = (
    <div className="space-y-2">
      {cities.map((c) => (
        <div key={c.city} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><MapPin className="size-5" /></span>
          <div className="min-w-0 flex-1"><p className="font-semibold">{c.city}</p><p className="text-xs text-muted-foreground">{flagByCountry[c.country]} {list.find((x) => x.code === c.country)?.name}</p></div>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><Buildings className="size-4" />{c.count}</span>
        </div>
      ))}
    </div>
  );
  else if (preview === "aucun" || results.length === 0) body = <NoResultsScreen compact query={preview === "aucun" ? undefined : q} filtered={preview === "aucun"} />;
  else body = (
    <div className="space-y-2">
      {results.map((c) => (
        <div key={c.code} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-lg">{flagByCountry[c.code] ?? "🌍"}</span>
          <div className="min-w-0 flex-1"><p className="font-semibold">{c.name} <span className="font-normal text-muted-foreground">· {c.dial}</span></p><p className="text-xs text-muted-foreground">{regionFor(c.code)} · {universityCount(c.code)} université{universityCount(c.code) > 1 ? "s" : ""}</p></div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions pour ${c.name}`}><MoreVertical className="size-5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => openForm(c)}><Pencil /> Modifier</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToDelete(c)} disabled={universityCount(c.code) > 0}><Trash /> Supprimer</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <PageHeader kicker="Administration" title="Géographie" description="Gérez les pays, régions et villes couverts par la plateforme." breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Géographie" }]}
        actions={preview !== "villes" ? <Button size="lg" onClick={() => openForm(null)}><Plus /> Ajouter un pays</Button> : undefined} />
      <StateSwitcher states={previews} value={preview} onChange={applyPreview} />

      <div role="tablist" className="mb-5 inline-flex rounded-lg border border-border bg-secondary p-1">
        <button role="tab" aria-selected={preview !== "villes"} onClick={() => setPreview("pays")} className={cn("flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold", preview !== "villes" ? "bg-card shadow-soft" : "text-muted-foreground")}><Globe2 className="size-4" /> Pays</button>
        <button role="tab" aria-selected={preview === "villes"} onClick={() => setPreview("villes")} className={cn("flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold", preview === "villes" ? "bg-card shadow-soft" : "text-muted-foreground")}><MapPin className="size-4" /> Villes</button>
      </div>

      {preview !== "villes" && preview !== "chargement" && preview !== "erreur" && (
        <div className="relative mb-4 max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un pays…" aria-label="Rechercher un pays" className="h-11 w-full rounded-lg border border-input bg-card pl-11 pr-9 text-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25" />
          {q && <button type="button" aria-label="Effacer" onClick={() => setQ("")} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button>}
        </div>
      )}

      {body}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display">{editing ? "Modifier le pays" : "Ajouter un pays"}</DialogTitle><DialogDescription>Il sera proposé lors de l'inscription des étudiants.</DialogDescription></DialogHeader>
          <Field label="Nom du pays" htmlFor="c-name"><IconInput id="c-name" icon={Globe2} placeholder="Ex. Sénégal" value={draft.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code (2 lettres)" htmlFor="c-code"><IconInput id="c-code" icon={Tag} maxLength={2} disabled={!!editing} placeholder="Ex. SN" value={draft.code} onChange={(e) => set("code", e.target.value.toUpperCase())} /></Field>
            <Field label="Indicatif" htmlFor="c-dial"><IconInput id="c-dial" icon={Phone} placeholder="Ex. +221" value={draft.dial} onChange={(e) => set("dial", e.target.value)} /></Field>
          </div>
          <Field label="Région" htmlFor="c-region"><Select value={draft.region} onValueChange={(v) => set("region", v)}><SelectTrigger id="c-region" className="h-11 bg-card"><SelectValue /></SelectTrigger><SelectContent>{regions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></Field>
          <DialogFooter><Button variant="outline" onClick={() => setFormOpen(false)}>Annuler</Button><Button disabled={!valid} onClick={save}>{editing ? "Enregistrer" : "Ajouter"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} title={`Supprimer ${toDelete?.name} ?`} description="Cette action n'est possible que si aucune université n'y est rattachée." confirmLabel="Supprimer" destructive
        onConfirm={() => { if (toDelete) { setList((cur) => cur.filter((c) => c.code !== toDelete.code)); toast.success("Pays supprimé"); } setToDelete(null); }} />
    </div>
  );
}
