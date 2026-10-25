import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, IconInput } from "@/components/cm/forms";
import { ConfirmDialog } from "@/components/cm/feedback";
import { EmptyScreen, ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { Buildings, MapPin, Pencil, Plus, Tag, Trash } from "@/components/icons";
import { useAuth } from "@/lib/auth";
import { PROVIDERS, REGIONS, flagFromCode, useAdminCountries, useAdminUniversities, useGeoActions, type AdminCountry, type CountryDraft } from "@/lib/api/admin-geo";
import { cn } from "@/lib/utils";

export type AdminGeoSearch = { onglet?: "villes" | undefined };

export const Route = createFileRoute("/_admin/admin/geographie/")({
  validateSearch: (s: Record<string, unknown>): AdminGeoSearch => ({ onglet: s["onglet"] === "villes" ? "villes" : undefined }),
  head: () => ({ meta: [{ title: "Géographie — Administration CampusMarket" }] }),
  component: AdminGeoPage,
});

const skeleton = <div aria-busy className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-foreground/10" />)}</div>;
const emptyDraft: CountryDraft = { code: "", name: "", dial: "+", region: REGIONS[0], providers: [] };

function AdminGeoPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin") || roles.includes("super_admin");
  const countries = useAdminCountries();
  const universities = useAdminUniversities();
  const tab = search.onglet === "villes" ? "villes" : "pays";
  const goTab = (t: "pays" | "villes") => void navigate({ search: { onglet: t === "villes" ? "villes" : undefined }, replace: true });

  return (
    <div>
      <PageHeader kicker="Administration" title="Géographie" description="Pays ouverts, indicatifs, moyens de paiement et villes couvertes." breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Géographie" }]} />
      <div role="tablist" className="mb-5 inline-flex rounded-lg border border-border bg-secondary p-1">
        <button role="tab" aria-selected={tab === "pays"} onClick={() => goTab("pays")} className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", tab === "pays" ? "bg-card shadow-soft" : "text-muted-foreground")}>Pays</button>
        <button role="tab" aria-selected={tab === "villes"} onClick={() => goTab("villes")} className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", tab === "villes" ? "bg-card shadow-soft" : "text-muted-foreground")}>Villes</button>
      </div>
      {!isAdmin && <p className="mb-4 rounded-lg border border-border bg-secondary px-3.5 py-2.5 text-sm text-muted-foreground">Lecture seule : seuls les administrateurs modifient la géographie.</p>}
      {tab === "pays" ? <CountriesTab isAdmin={isAdmin} countries={countries} universities={universities.data ?? []} /> : <CitiesTab countries={countries.data ?? []} query={universities} />}
    </div>
  );
}

function CountriesTab({ isAdmin, countries, universities }: { isAdmin: boolean; countries: ReturnType<typeof useAdminCountries>; universities: { countryCode: string }[] }) {
  const actions = useGeoActions();
  const [editing, setEditing] = useState<AdminCountry | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<AdminCountry | null>(null);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of universities) m.set(u.countryCode, (m.get(u.countryCode) ?? 0) + 1);
    return m;
  }, [universities]);

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const remove = async () => {
    if (!toDelete) return;
    try { await actions.deleteCountry.mutateAsync(toDelete.code); toast.success("Pays supprimé."); }
    catch (e) { toast.error(actions.errorText(e, "Suppression impossible.")); }
    setToDelete(null);
  };

  if (countries.isLoading) return skeleton;
  if (countries.isError) return <ServerErrorScreen compact onRetry={() => void countries.refetch()} />;
  const rows = countries.data ?? [];
  if (rows.length === 0) return <EmptyScreen compact title="Aucun pays" description="Ajoutez le premier pays ouvert." actions={isAdmin ? <Button onClick={openNew}><Plus /> Ajouter</Button> : undefined} />;

  return (
    <div>
      {isAdmin && <div className="mb-3 flex justify-end"><Button onClick={openNew}><Plus /> Ajouter un pays</Button></div>}
      <ul className="space-y-2">
        {rows.map((c) => {
          const n = counts.get(c.code) ?? 0;
          return (
            <li key={c.code} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
              <span className="text-2xl" aria-hidden>{c.flag}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.name} <span className="text-xs font-normal text-muted-foreground">{c.code} · {c.dial}</span></p>
                <p className="truncate text-xs text-muted-foreground">{c.region || "Région non renseignée"} · {n} université{n > 1 ? "s" : ""}</p>
                <p className="truncate text-xs text-muted-foreground">{c.providers.length ? c.providers.join(", ") : "Aucun moyen de paiement"}</p>
              </div>
              {isAdmin && (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" aria-label={`Modifier ${c.name}`} onClick={() => { setEditing(c); setFormOpen(true); }}><Pencil /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Supprimer ${c.name}`} disabled={n > 0} title={n > 0 ? "Des universités sont rattachées" : undefined} onClick={() => setToDelete(c)}><Trash /></Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <CountryDialog open={formOpen} onOpenChange={setFormOpen} initial={editing} />
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} destructive title={`Supprimer ${toDelete?.name ?? ""} ?`}
        description="Le pays disparaît de l'inscription. Impossible tant que des universités y sont rattachées." confirmLabel="Supprimer" onConfirm={remove} />
    </div>
  );
}

function CountryDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial: AdminCountry | null }) {
  const actions = useGeoActions();
  const [draft, setDraft] = useState<CountryDraft>(emptyDraft);
  const [seen, setSeen] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const key = open ? (initial?.code ?? "new") : "";
  if (key !== seen) {
    setSeen(key);
    if (open) { setDraft(initial ? { code: initial.code, name: initial.name, dial: initial.dial, region: initial.region || REGIONS[0], providers: initial.providers } : emptyDraft); setError(null); }
  }
  const set = <K extends keyof CountryDraft>(k: K, v: CountryDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const toggle = (p: string) => set("providers", draft.providers.includes(p) ? draft.providers.filter((x) => x !== p) : [...draft.providers, p]);

  const submit = async () => {
    const code = draft.code.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return setError("Le code pays comporte 2 lettres (ex. CM).");
    if (draft.name.trim().length < 2) return setError("Indiquez le nom du pays.");
    if (!/^\+\d{1,4}$/.test(draft.dial.trim())) return setError("L'indicatif ressemble à +237.");
    setError(null);
    try {
      await actions.saveCountry.mutateAsync({ draft: { ...draft, code, name: draft.name.trim(), dial: draft.dial.trim() }, editing: !!initial });
      toast.success(initial ? "Pays mis à jour." : "Pays ajouté.");
      onOpenChange(false);
    } catch (e) { setError(actions.errorText(e, "Enregistrement impossible.")); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? `Modifier ${initial.name}` : "Ajouter un pays"}</DialogTitle>
          <DialogDescription>Le code et l'indicatif servent à l'inscription et aux paiements Mobile Money.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code (2 lettres)" htmlFor="c-code"><IconInput id="c-code" icon={Tag} maxLength={2} disabled={!!initial} placeholder="CM" value={draft.code} onChange={(e) => set("code", e.target.value.toUpperCase())} /></Field>
            <Field label="Indicatif" htmlFor="c-dial"><IconInput id="c-dial" icon={Tag} maxLength={5} placeholder="+237" value={draft.dial} onChange={(e) => set("dial", e.target.value)} /></Field>
          </div>
          <Field label="Nom" htmlFor="c-name"><IconInput id="c-name" icon={MapPin} maxLength={80} placeholder="Cameroun" value={draft.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Région" htmlFor="c-region">
            <select id="c-region" className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" value={draft.region} onChange={(e) => set("region", e.target.value)}>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Moyens de paiement {draft.code.length === 2 && <span aria-hidden>{flagFromCode(draft.code.toUpperCase())}</span>}</legend>
            <div className="flex flex-wrap gap-2">
              {PROVIDERS.map((p) => (
                <button key={p} type="button" aria-pressed={draft.providers.includes(p)} onClick={() => toggle(p)}
                  className={cn("rounded-full border px-3 py-1 text-sm", draft.providers.includes(p) ? "border-primary bg-primary/10 font-semibold" : "border-border text-muted-foreground")}>{p}</button>
              ))}
            </div>
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={() => void submit()} disabled={actions.saveCountry.isPending}>{actions.saveCountry.isPending ? "Enregistrement…" : "Enregistrer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CitiesTab({ countries, query }: { countries: AdminCountry[]; query: ReturnType<typeof useAdminUniversities> }) {
  const cities = useMemo(() => {
    const m = new Map<string, { city: string; countryCode: string; total: number; active: number }>();
    for (const u of query.data ?? []) {
      const k = `${u.countryCode}|${u.city.trim().toLowerCase()}`;
      const e = m.get(k) ?? { city: u.city.trim(), countryCode: u.countryCode, total: 0, active: 0 };
      e.total += 1;
      if (u.active) e.active += 1;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => a.countryCode.localeCompare(b.countryCode) || a.city.localeCompare(b.city));
  }, [query.data]);
  const nameOf = (code: string) => countries.find((c) => c.code === code)?.name ?? code;

  if (query.isLoading) return skeleton;
  if (query.isError) return <ServerErrorScreen compact onRetry={() => void query.refetch()} />;
  if (cities.length === 0) return <EmptyScreen compact title="Aucune ville" description="Les villes apparaissent dès qu'une université y est ajoutée." />;
  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">Les villes proviennent des universités : ajoutez une université pour ouvrir une ville.</p>
      <ul className="space-y-2">
        {cities.map((c) => (
          <li key={`${c.countryCode}|${c.city}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
            <span className="text-xl" aria-hidden>{flagFromCode(c.countryCode)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{c.city}</p>
              <p className="truncate text-xs text-muted-foreground">{nameOf(c.countryCode)}</p>
            </div>
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Buildings className="size-4" />{c.active}/{c.total}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
