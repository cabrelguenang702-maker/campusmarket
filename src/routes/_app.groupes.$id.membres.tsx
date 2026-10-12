import { createFileRoute } from "@tanstack/react-router";
import { SpaceMembersPage } from "@/components/community/SpacePages";

export const Route = createFileRoute("/_app/groupes/$id/membres")({
  head: () => ({ meta: [{ title: "Membres — Groupe" }] }),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  return <SpaceMembersPage key={id} kind="groupe" id={id} />;
}
