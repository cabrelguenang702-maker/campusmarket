import { useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SearchField } from "@/components/cm/forms";
import { EmptyScreen, NetworkErrorScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { RequestsList } from "@/components/tutoring/RequestsList";
import { TutorCard, TutorCardSkeleton } from "@/components/tutoring/TutorCard";
import { TutorProfileForm } from "@/components/tutoring/TutorProfileForm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isNetworkError } from "@/lib/api/errors";
import { MODE_LABEL, useTutors } from "@/lib/api/tutoring";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type Onglet = "annuaire" | "demandes" | "profil";
export type TutoratSearch = { onglet?: "demandes" | "profil" | undefined; q?: string | undefined; mode?: "online" | "in_person" | undefined };

export const Route = createFileRoute("/_app/tutorat/")({
  validateSearch: (s: Record<string, unknown>): TutoratSearch => ({
    onglet: s["onglet"] === "demandes" || s["onglet"] === "profil" ? s["onglet"] : undefined,
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    mode: s["mode"] === "online" || s["mode"] === "in_person" ? s["mode"] : undefined,
  }),
  head: () => ({ meta: [{ title: "Tutorat — CampusMarket" }, { name: "description", content: "Trouvez un étudiant qui vous aide dans une matière, ou devenez tuteur." }] }),
  component: TutoratPage,
});

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const ANY = "any";

function TutoratPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { session } = useAuth();
  const userId = session?.user.id;
  const tab: Onglet = search.onglet ?? "annuaire";
  const q = search.q ?? "";
  const query = useTutors();
  const setSearch = (patch: Partial<TutoratSearch>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const tutors = useMemo(() => {
    const needle = normalize(q.trim());
    return (query.data ?? [])
      .filter((t) => t.userId !== userId)
      .filter((t) => !search.mode || t.mode === "both" || t.mode === search.mode)
      .filter((t) => !needle || normalize(`${t.name} ${t.subjects.join(" ")} ${t.filiere ?? ""}`).includes(needle));
  }, [query.data, q, search.mode, userId]);

  const TABS: [Onglet, string][] = [["annuaire", "Trouver un tuteur"], ["demandes", "Mes demandes"], ["profil", "Mon profil tuteur"]];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader kicker="Campus Academy" title="Tutorat" description="Trouvez un étudiant qui vous aide dans une matière, ou devenez tuteur à votre tour."
        breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Formations", to: "/formations" }, { label: "Tutorat" }]} />
      <div role="tablist" aria-label="Tutorat" className="mb-5 inline-flex flex-wrap rounded-lg border border-border bg-secondary p-1">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setSearch({ onglet: id === "annuaire" ? undefined : id })}
            className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", tab === id ? "bg-card shadow-soft" : "text-muted-foreground")}>{label}</button>
        ))}
      </div>

      {tab === "demandes" && <RequestsList />}
      {tab === "profil" && <TutorProfileForm />}
      {tab === "annuaire" && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 basis-60"><SearchField aria-label="Rechercher un tuteur" placeholder="Rechercher une matière ou un nom" value={q} onChange={(e) => setSearch({ q: e.target.value || undefined })} /></div>
            <Select value={search.mode ?? ANY} onValueChange={(v) => setSearch({ mode: v === ANY ? undefined : (v as "online" | "in_person") })}>
              <SelectTrigger aria-label="Mode de séance" className="h-10 w-full bg-secondary sm:w-52"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ANY}>Tous les modes</SelectItem><SelectItem value="online">{MODE_LABEL.online}</SelectItem><SelectItem value="in_person">{MODE_LABEL.in_person}</SelectItem></SelectContent>
            </Select>
          </div>
          {query.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <TutorCardSkeleton key={i} />)}</div>
          ) : query.isError ? (
            isNetworkError(query.error) ? <NetworkErrorScreen compact onRetry={() => void query.refetch()} /> : <ServerErrorScreen compact onRetry={() => void query.refetch()} />
          ) : tutors.length === 0 ? (
            q || search.mode ? <NoResultsScreen compact query={q} /> : <EmptyScreen compact title="Aucun tuteur pour l'instant" description="Soyez le premier : devenez tuteur depuis l'onglet « Mon profil tuteur »." />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{tutors.map((t) => <li key={t.userId}><TutorCard tutor={t} /></li>)}</ul>
          )}
        </>
      )}
    </div>
  );
}
