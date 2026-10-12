import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, BadgeCheck, Check, Party } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { RequireSession, useAuth } from "@/lib/auth";
import { formatCameroonPhone } from "@/lib/auth-utils";
import { REGISTRATION_PAYMENT_ENABLED } from "@/lib/config";
import { formatFcfa, REGISTRATION_FEE } from "@/lib/mock-data";

export const Route = createFileRoute("/_auth/inscription/compte-cree")({
  head: () => ({ meta: [{ title: "Compte créé — CampusMarket" }] }),
  component: () => <RequireSession><AccountCreatedPage /></RequireSession>,
});

function AccountCreatedPage() {
  const { account, session } = useAuth();
  const profile = account?.profile;
  const phone = account?.private?.phone ?? null;
  const phoneVerified = account?.private?.phoneVerified ?? false;
  const emailVerified = Boolean(session?.user.email_confirmed_at);
  const university = profile?.campus ? `${profile.campus}${profile.city ? ` · ${profile.city}` : ""}` : null;

  // `done` : étape réellement accomplie. Une étape passée (téléphone) ou non confirmée n'est pas présentée comme faite.
  const recap: { label: string; value: string; done: boolean }[] = [
    { label: phoneVerified ? "Téléphone vérifié" : "Téléphone", value: phoneVerified && phone ? formatCameroonPhone(phone) : "À vérifier plus tard", done: phoneVerified },
    { label: emailVerified ? "E-mail vérifié" : "E-mail", value: account?.private?.email ?? session?.user.email ?? "—", done: emailVerified },
    { label: "Université", value: university ?? "Non renseignée", done: Boolean(university) },
    ...(REGISTRATION_PAYMENT_ENABLED ? [{ label: "Inscription réglée", value: formatFcfa(REGISTRATION_FEE), done: true }] : []),
  ];

  return (
    <div className="fade-up flex flex-1 flex-col items-center text-center">
      <span className="relative mt-4 grid size-24 place-items-center rounded-full bg-success/15 text-success">
        <span className="absolute inset-0 animate-ping rounded-full bg-success/10 [animation-iteration-count:2]" />
        <Party className="relative size-12" />
      </span>
      <p className="section-kicker mt-6">Inscription terminée</p>
      <h1 className="font-display text-3xl font-bold leading-tight">Votre compte est prêt !</h1>
      <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">Bienvenue sur CampusMarket. Vous pouvez dès maintenant explorer les annonces de votre campus.</p>

      <ul className="mt-6 w-full divide-y divide-border rounded-lg border border-border bg-card text-left text-sm">
        {recap.map(({ label, value, done }) => (
          <li key={label} className="flex items-center gap-3 px-4 py-3">
            <span className={done ? "grid size-6 shrink-0 place-items-center rounded-full bg-success/15 text-success" : "grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"}>
              {done ? <Check className="size-3.5" /> : <span aria-hidden className="text-xs font-bold">–</span>}
            </span>
            <span className="flex-1 text-muted-foreground">{label}</span>
            <span className="max-w-[55%] truncate text-right font-semibold">{value}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex w-full items-center gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3.5 text-left">
        <span className="grid size-11 shrink-0 place-items-center rounded-md bg-primary/12 text-primary"><BadgeCheck className="size-6" /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Obtenez le badge « Étudiant vérifié »</span><span className="block text-xs text-muted-foreground">Ajoutez votre carte étudiante pour rassurer acheteurs et vendeurs.</span></span>
        <Button asChild size="sm" variant="soft" className="shrink-0"><AppLink to="/profil/verification">Vérifier</AppLink></Button>
      </div>

      <Button asChild size="lg" className="mt-6 w-full"><AppLink to="/">Accéder à CampusMarket <ArrowRight /></AppLink></Button>
    </div>
  );
}
