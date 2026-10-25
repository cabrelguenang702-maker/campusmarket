import { Link, createFileRoute } from "@tanstack/react-router";
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
      <div className="max-w-xl space-y-4">
        <MfaPanel />
        <div className="rounded-xl border border-border bg-card p-4 text-sm">
          <p className="font-semibold">Appareils, historique et mot de passe</p>
          <p className="mt-1 text-muted-foreground">Consultez vos appareils connus et vos dernières connexions, changez votre mot de passe ou déconnectez les autres appareils.</p>
          <Link to="/profil/parametres" search={{ section: "securite" }} className="mt-2 inline-block font-semibold text-primary hover:underline">Ouvrir les paramètres de sécurité</Link>
        </div>
      </div>
    </div>
  );
}
