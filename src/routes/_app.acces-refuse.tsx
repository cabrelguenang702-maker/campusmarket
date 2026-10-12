import { createFileRoute } from "@tanstack/react-router";
import { ForbiddenScreen } from "@/components/cm/screens";

export const Route = createFileRoute("/_app/acces-refuse")({
  head: () => ({ meta: [{ title: "Accès refusé — CampusMarket" }] }),
  component: () => <ForbiddenScreen />,
});
