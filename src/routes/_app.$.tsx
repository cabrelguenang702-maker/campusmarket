import { createFileRoute, useLocation } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Rocket } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { NotFoundScreen } from "@/components/cm/screens";
import { StateScreen } from "@/components/cm/feedback";
import { PageHeader } from "@/components/layout/PageHeader";
import { findPlannedRoute, phases } from "@/lib/planned-routes";

/**
 * Route « attrape-tout » du layout applicatif.
 * - route prévue au master mais pas encore construite  → écran « en cours de conception »
 * - route inconnue                                     → 404
 */
export const Route = createFileRoute("/_app/$")({
  component: PlannedOrNotFound,
});

function PlannedOrNotFound() {
  const pathname = useLocation({ select: (l) => l.pathname });
  const planned = findPlannedRoute(pathname);
  if (!planned) return <NotFoundScreen />;
  const phase = phases.find((p) => p.id === planned.phase);
  return (
    <div>
      <PageHeader kicker={`Phase ${planned.phase}`} title={planned.title} breadcrumbs={[{ label: "Accueil", to: "/" }, { label: planned.title }]} />
      <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5">
        <StateScreen
          icon={Rocket}
          tone="primary"
          title="Écran en cours de conception"
          description={`${planned.scope}. Cet écran fait partie de la phase ${planned.phase} du master${phase ? ` — « ${phase.title} »` : ""}.`}
          actions={<><Button asChild size="lg"><AppLink to="/">Retour à l'accueil</AppLink></Button></>}
        />
        <div className="flex flex-wrap justify-center gap-2 pb-8">
          <Pill tone="primary">{planned.screens} écrans et états au master</Pill>
          <Pill tone="neutral">{pathname}</Pill>
        </div>
      </div>
    </div>
  );
}
