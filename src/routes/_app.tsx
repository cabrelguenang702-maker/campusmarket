import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { RequireAuth } from "@/lib/auth";

/** Layout des pages « utilisateur » : sidebar desktop, header, navigation basse mobile. Réservé aux connectés. */
export const Route = createFileRoute("/_app")({
  component: () => (
    <RequireAuth>
      <AppShell>
        <Outlet />
      </AppShell>
    </RequireAuth>
  ),
});
