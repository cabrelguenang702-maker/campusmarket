import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SpacesListPage, type SpacesSearch } from "@/components/community/SpacePages";

export type GroupsSearch = SpacesSearch;

export const Route = createFileRoute("/_app/groupes/")({
  validateSearch: (s: Record<string, unknown>): SpacesSearch => ({
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    categorie: typeof s["categorie"] === "string" && s["categorie"] ? s["categorie"] : undefined,
  }),
  head: () => ({ meta: [{ title: "Groupes — CampusMarket" }, { name: "description", content: "Rejoignez des groupes pour échanger avec votre classe, votre promotion ou votre équipe." }] }),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return <SpacesListPage kind="groupe" search={search} onSearch={(patch) => void navigate({ search: (prev) => ({ ...prev, ...patch }) })} />;
}
