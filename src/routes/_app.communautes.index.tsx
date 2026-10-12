import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SpacesListPage, type SpacesSearch } from "@/components/community/SpacePages";

export type CommunitiesSearch = SpacesSearch;

export const Route = createFileRoute("/_app/communautes/")({
  validateSearch: (s: Record<string, unknown>): SpacesSearch => ({
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    categorie: typeof s["categorie"] === "string" && s["categorie"] ? s["categorie"] : undefined,
  }),
  head: () => ({ meta: [{ title: "Communautés — CampusMarket" }, { name: "description", content: "Rejoignez des communautés d'étudiants qui partagent vos centres d'intérêt." }] }),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return <SpacesListPage kind="communaute" search={search} onSearch={(patch) => void navigate({ search: (prev) => ({ ...prev, ...patch }) })} />;
}
