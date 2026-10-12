import { createFileRoute } from "@tanstack/react-router";
import { SpaceDetailPage } from "@/components/community/SpacePages";

export const Route = createFileRoute("/_app/groupes/$id/")({
  head: () => ({ meta: [{ title: "Groupe — CampusMarket" }] }),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  return <SpaceDetailPage key={id} kind="groupe" id={id} />;
}
