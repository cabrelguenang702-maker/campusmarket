import { createFileRoute, redirect } from "@tanstack/react-router";

/** Ancien lien direct : les achats du membre sont un onglet de /profil. */
export const Route = createFileRoute("/_app/profil/achats")({
  beforeLoad: () => { throw redirect({ to: "/profil", search: { onglet: "achats" } }); },
});
