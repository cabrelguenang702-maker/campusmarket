import { createFileRoute } from "@tanstack/react-router";
import { SpaceDetailPage } from "@/components/community/SpacePages";

export const Route = createFileRoute("/_app/communautes/$id/")({
  head: () => ({ meta: [{ title: "Communauté — CampusMarket" }] }),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  return <SpaceDetailPage key={id} kind="communaute" id={id} />;
}
