import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/layout/LegalLayout";

/** Pages légales : volontairement SANS garde d'accès (visibles avant l'inscription, connecté ou non). */
export const Route = createFileRoute("/_legal")({
  component: LegalLayout,
});
