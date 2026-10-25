import { AppLink } from "@/components/cm/app-link";
import { cn } from "@/lib/utils";

/** Liens vers les pages légales, partagés par les pieds de page (authentification, application, pages légales). */
export function LegalLinks({ className, newTab = false }: { className?: string; newTab?: boolean }) {
  const extra = newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};
  const link = "hover:text-primary hover:underline";
  return (
    <p className={cn("text-center text-[11px] text-muted-foreground", className)}>
      <AppLink to="/conditions" className={link} {...extra}>Conditions d'utilisation</AppLink>{" · "}
      <AppLink to="/confidentialite" className={link} {...extra}>Confidentialité</AppLink>{" · "}
      <AppLink to="/mentions-legales" className={link} {...extra}>Mentions légales</AppLink>
    </p>
  );
}
