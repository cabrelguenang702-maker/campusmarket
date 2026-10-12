import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";

type SearchValue = string | number | boolean | undefined;

/**
 * Lien interne du projet. Certaines routes du master ne sont pas encore construites :
 * le type `to` est donc volontairement un simple `string` (le routeur affichera l'écran
 * « à venir » ou la 404 tant que la route n'existe pas). À resserrer au fil des phases.
 * `search` permet de passer des paramètres d'URL (ex. { categorie: "telephones" }).
 */
export function AppLink({ to, search, ...props }: Omit<ComponentProps<typeof Link>, "to" | "search"> & { to: string; search?: Record<string, SearchValue> }) {
  const extra = search ? ({ search } as object) : {};
  return <Link to={to as "/"} {...extra} {...props} />;
}
