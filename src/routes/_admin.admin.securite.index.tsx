import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { MfaPanel } from "@/components/admin/MfaPanel";

export const Route = createFileRoute("/_admin/admin/securite/")({
  head: () => ({ meta: [{ title: "Sécurité — Administration CampusMarket" }] }),
  component: AdminSecurityPage,
});

function AdminSecurityPage() {
  return (
    <div>
      <PageHeader kicker="Mon compte" title="Sécurité" description="La double authentification protège les actions sensibles du back-office." breadcrumbs={[{ label: "Administration", to: "/admin" }, { label: "Sécurité" }]} />
      <div className="max-w-xl"><MfaPanel /></div>
    </div>
  );
}
