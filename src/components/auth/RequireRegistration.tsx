import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useMyRegistration } from "@/lib/api/registration";

/** Garde d'interface : un compte dont l'inscription n'est pas encore payée est renvoyé vers l'écran de paiement.
 *  La vraie protection est côté base (un compte en attente n'est pas « actif »). En cas d'erreur de lecture, on laisse passer :
 *  la base refusera de toute façon ce qui n'est pas autorisé. */
export function RequireRegistration({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const reg = useMyRegistration(session?.user.id);
  const blocked = reg.data?.status === "pending_payment" && !pathname.startsWith("/inscription");

  useEffect(() => { if (blocked) void navigate({ to: "/inscription/paiement", replace: true }); }, [blocked, navigate]);

  if (blocked) return null;
  return <>{children}</>;
}
