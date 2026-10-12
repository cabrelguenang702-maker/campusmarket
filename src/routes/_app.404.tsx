import { createFileRoute } from "@tanstack/react-router";
import { NotFoundScreen } from "@/components/cm/screens";

export const Route = createFileRoute("/_app/404")({
  head: () => ({ meta: [{ title: "Page introuvable — CampusMarket" }] }),
  component: () => <NotFoundScreen />,
});
