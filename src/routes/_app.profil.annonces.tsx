import { createFileRoute, redirect } from "@tanstack/react-router";

/** Ancien lien direct : les annonces du membre sont un onglet de /profil. */
export const Route = createFileRoute("/_app/profil/annonces")({
  beforeLoad: () => { throw redirect({ to: "/profil", search: { onglet: "annonces" } }); },
});
