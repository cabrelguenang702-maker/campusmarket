import { createFileRoute } from "@tanstack/react-router";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { RequireGuest } from "@/lib/auth";

/** Layout des écrans d'authentification (bienvenue, inscription, connexion, récupération). */
export const Route = createFileRoute("/_auth")({
  component: () => (
    <RequireGuest>
      <AuthLayout />
    </RequireGuest>
  ),
});
