import { Button } from "@/components/ui/button";
import { ShieldCheck } from "@/components/icons";
import { Logo } from "@/components/cm/brand";
import { InlineAlert, Spinner } from "@/components/cm/feedback";
import { MfaChallenge } from "@/components/admin/MfaPanel";
import { useMfaState } from "@/lib/api/mfa";
import { recordLogin } from "@/lib/api/security";

/**
 * Étape « code » après le mot de passe pour les comptes qui ont activé la double authentification.
 * Tant que le code n'est pas saisi, la base refuse tout accès aux données (politique mfa_required, voir 0039) :
 * cet écran n'est donc pas qu'un habillage.
 */
export function MfaChallengeScreen({ onSignOut }: { onSignOut: () => void }) {
  const state = useMfaState();
  const factor = state.data?.factors[0];
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-primary/12 text-primary"><ShieldCheck className="size-7" /></span>
          <h1 className="mt-4 text-center font-display text-xl font-bold">Vérification en deux étapes</h1>
          <p className="mt-1.5 text-center text-sm text-muted-foreground">Saisissez le code à 6 chiffres affiché par votre application d'authentification.</p>
          <div className="mt-6">
            {state.isPending ? <div className="grid place-items-center py-6"><Spinner className="size-5" /></div>
              : state.isError || !factor ? <InlineAlert tone="danger" title="Impossible de lire votre configuration">Réessayez dans un instant. <button className="font-semibold underline" onClick={() => void state.refetch()}>Recharger</button></InlineAlert>
              : <MfaChallenge factorId={factor.id} onDone={() => void recordLogin()} />}
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">Téléphone perdu ? Contactez le support : un administrateur pourra réinitialiser la vérification.</p>
        <div className="mt-3 text-center"><Button variant="ghost" size="sm" onClick={onSignOut}>Se déconnecter</Button></div>
      </div>
    </div>
  );
}
