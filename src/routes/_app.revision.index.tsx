import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/cm/forms";
import { EmptyScreen, NetworkErrorScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { GroupCard, GroupCardSkeleton } from "@/components/study/GroupCard";
import { GroupFormDialog } from "@/components/study/GroupFormDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { Plus } from "@/components/icons";
import { isNetworkError } from "@/lib/api/errors";
import { useStudyGroups } from "@/lib/api/study-groups";
import { cn } from "@/lib/utils";

type Vue = "decouvrir" | "mes";
export type RevisionSearch = { q?: string | undefined; vue?: "mes" | undefined };

export const Route = createFileRoute("/_app/revision/")({
  validateSearch: (s: Record<string, unknown>): RevisionSearch => ({
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    vue: s["vue"] === "mes" ? "mes" : undefined,
  }),
  head: () => ({ meta: [{ title: "Groupes de révision — CampusMarket" }, { name: "description", content: "Révisez à plusieurs : rejoignez un groupe d'étudiants ou créez le vôtre, avec des séances planifiées." }] }),
  component: RevisionPage,
});

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function RevisionPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const query = useStudyGroups();
  const [creating, setCreating] = useState(false);
  const vue: Vue = search.vue === "mes" ? "mes" : "decouvrir";
  const q = search.q ?? "";
  const setSearch = (patch: Partial<RevisionSearch>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const groups = useMemo(() => {
    const all = query.data ?? [];
    const needle = normalize(q.trim());
    return all
      .filter((g) => (vue === "mes" ? g.isMember : true))
      .filter((g) => !needle || normalize(`${g.title} ${g.subject} ${g.courseTitle ?? ""}`).includes(needle));
  }, [query.data, vue, q]);
  const mineCount = (query.data ?? []).filter((g) => g.isMember).length;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader kicker="Campus Academy" title="Groupes de révision" description="Révisez à plusieurs : rejoignez un groupe d'étudiants ou créez le vôtre, avec des séances planifiées."
        breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Formations", to: "/formations" }, { label: "Groupes de révision" }]}
        actions={<Button onClick={() => setCreating(true)}><Plus /> Créer un groupe</Button>} />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Affichage" className="inline-flex rounded-lg border border-border bg-secondary p-1">
          {([["decouvrir", "Découvrir"], ["mes", `Mes groupes${mineCount > 0 ? ` (${mineCount})` : ""}`]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={vue === id} onClick={() => setSearch({ vue: id === "mes" ? "mes" : undefined })}
              className={cn("rounded-md px-3.5 py-1.5 text-sm font-semibold", vue === id ? "bg-card shadow-soft" : "text-muted-foreground")}>{label}</button>
          ))}
        </div>
        <div className="min-w-0 flex-1 basis-60">
          <SearchField aria-label="Rechercher un groupe" placeholder="Rechercher par nom, matière ou formation" value={q} onChange={(e) => setSearch({ q: e.target.value || undefined })} />
        </div>
      </div>

      {query.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <GroupCardSkeleton key={i} />)}</div>
      ) : query.isError ? (
        isNetworkError(query.error) ? <NetworkErrorScreen compact onRetry={() => void query.refetch()} /> : <ServerErrorScreen compact onRetry={() => void query.refetch()} />
      ) : groups.length === 0 ? (
        q ? <NoResultsScreen compact query={q} /> : (
          <EmptyScreen compact title={vue === "mes" ? "Vous n'êtes dans aucun groupe" : "Aucun groupe pour l'instant"}
            description={vue === "mes" ? "Rejoignez un groupe existant ou créez le vôtre pour réviser avec d'autres étudiants." : "Soyez le premier à créer un groupe de révision."}
            actions={<Button onClick={() => setCreating(true)}><Plus /> Créer un groupe</Button>} />
        )
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{groups.map((g) => <li key={g.id} className="flex"><div className="flex w-full flex-col [&>a]:flex-1"><GroupCard group={g} /></div></li>)}</ul>
      )}

      <GroupFormDialog open={creating} onOpenChange={setCreating} group={null} onCreated={(id) => void navigate({ to: "/revision/$id", params: { id } })} />
    </div>
  );
}
