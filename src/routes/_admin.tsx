import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { AdminShell } from "@/components/layout/AdminShell";
import { AppLink } from "@/components/cm/app-link";
import { InlineAlert } from "@/components/cm/feedback";
import { RequireBackOffice } from "@/lib/auth";
import { useMfaState } from "@/lib/api/mfa";

/** Layout des pages « administration » : sidebar dédiée, réservée au personnel (garde d'interface : la RLS décide). */
export const Route = createFileRoute("/_admin")({
  component: () => (
    <RequireBackOffice>
      <AdminShell>
        <MfaBanner />
        <Outlet />
      </AdminShell>
    </RequireBackOffice>
  ),
});

/** Rappel permanent tant que la session n'est pas en aal2 : la base refuse les actions sensibles sans elle. */
function MfaBanner() {
  const { data } = useMfaState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!data || data.currentLevel === "aal2" || pathname.startsWith("/admin/securite")) return null;
  const hasFactor = data.factors.length > 0;
  return (
    <InlineAlert tone="warning" className="mb-4" title={hasFactor ? "Saisissez votre code de sécurité" : "Activez la double authentification"}
      action={<AppLink to="/admin/securite" className="text-sm font-semibold underline underline-offset-2">{hasFactor ? "Vérifier" : "Activer"}</AppLink>}>
      Les actions sensibles (bannissement, rôles, modération) sont refusées tant que cette session n'est pas sécurisée.
    </InlineAlert>
  );
}
