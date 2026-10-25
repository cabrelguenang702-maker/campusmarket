import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EmptyScreen, NetworkErrorScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { SearchField } from "@/components/cm/forms";
import { JobCard, JobsTabs } from "@/components/jobs/JobBits";
import { PageHeader } from "@/components/layout/PageHeader";
import { isNetworkError } from "@/lib/api/errors";
import { useCountries } from "@/lib/api/geo";
import { KIND_LABEL, LEVEL_LABEL, MODE_LABEL, useJobOffers, type JobKind, type JobLevel, type WorkMode } from "@/lib/api/jobs";

export type JobsSearch = { q?: string | undefined; type?: JobKind | undefined; pays?: string | undefined; mode?: WorkMode | undefined; niveau?: JobLevel | undefined };
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);

export const Route = createFileRoute("/_app/emplois/")({
  validateSearch: (s: Record<string, unknown>): JobsSearch => ({
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    type: pick(s["type"], Object.keys(KIND_LABEL) as JobKind[]),
    pays: typeof s["pays"] === "string" && /^[A-Za-z]{2}$/.test(s["pays"]) ? s["pays"].toUpperCase() : undefined,
    mode: pick(s["mode"], Object.keys(MODE_LABEL) as WorkMode[]),
    niveau: pick(s["niveau"], Object.keys(LEVEL_LABEL) as JobLevel[]),
  }),
  head: () => ({ meta: [{ title: "Campus Jobs — CampusMarket" }, { name: "description", content: "Stages, emplois, missions et bénévolat pour étudiants et jeunes diplômés." }] }),
  component: JobsPage,
});

const selectClass = "h-10 rounded-md border bg-background px-3 text-sm";

function JobsPage() {
  const s = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [q, setQ] = useState(s.q ?? "");
  const countries = useCountries();
  const query = useJobOffers({ q: s.q, kind: s.type, country: s.pays, mode: s.mode, level: s.niveau });
  const set = (patch: Partial<JobsSearch>) => void navigate({ search: (prev) => ({ ...prev, ...patch }) });
  const filtered = !!(s.q || s.type || s.pays || s.mode || s.niveau);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <PageHeader kicker="Campus Jobs" title="Stages, emplois et missions" description="Des opportunités publiées par des organisations vérifiées ou modérées par notre équipe." />
      <JobsTabs active="offres" />
      <form className="mb-3" role="search" onSubmit={(e) => { e.preventDefault(); set({ q: q.trim() || undefined }); }}>
        <SearchField value={q} onChange={(e) => setQ(e.target.value)} placeholder="Poste, organisation, domaine…" aria-label="Rechercher une offre" />
      </form>
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select aria-label="Type" className={selectClass} value={s.type ?? ""} onChange={(e) => set({ type: pick(e.target.value, Object.keys(KIND_LABEL) as JobKind[]) })}>
          <option value="">Tous les types</option>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Pays" className={selectClass} value={s.pays ?? ""} onChange={(e) => set({ pays: e.target.value || undefined })}>
          <option value="">Tous les pays</option>{(countries.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select aria-label="Mode de travail" className={selectClass} value={s.mode ?? ""} onChange={(e) => set({ mode: pick(e.target.value, Object.keys(MODE_LABEL) as WorkMode[]) })}>
          <option value="">Tous les modes</option>{Object.entries(MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Niveau" className={selectClass} value={s.niveau ?? ""} onChange={(e) => set({ niveau: pick(e.target.value, Object.keys(LEVEL_LABEL) as JobLevel[]) })}>
          <option value="">Tous niveaux</option>{Object.entries(LEVEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {query.isLoading ? (
        <div aria-busy className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-foreground/10" />)}</div>
      ) : query.isError ? (
        isNetworkError(query.error) ? <NetworkErrorScreen onRetry={() => void query.refetch()} /> : <ServerErrorScreen onRetry={() => void query.refetch()} />
      ) : (query.data ?? []).length === 0 ? (
        filtered
          ? <NoResultsScreen filtered query={s.q} />
          : <EmptyScreen title="Aucune offre pour le moment" description="Les nouvelles offres apparaîtront ici dès leur publication." />
      ) : (
        <ul className="space-y-3">{(query.data ?? []).map((o) => <li key={o.id}><JobCard o={o} /></li>)}</ul>
      )}
    </div>
  );
}
