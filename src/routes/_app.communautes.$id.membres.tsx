import { createFileRoute } from "@tanstack/react-router";
import { SpaceMembersPage } from "@/components/community/SpacePages";

export const Route = createFileRoute("/_app/communautes/$id/membres")({
  head: () => ({ meta: [{ title: "Membres — Communauté" }] }),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  return <SpaceMembersPage key={id} kind="communaute" id={id} />;
}
