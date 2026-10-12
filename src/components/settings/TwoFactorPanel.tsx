import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Check, ShieldCheck } from "@/components/icons";
import { ConfirmDialog, InlineAlert, Spinner } from "@/components/cm/feedback";
import { OtpField } from "@/components/cm/forms";
import { SettingsCard } from "@/components/cm/setting-row";
import { mfaErrorMessage } from "@/components/admin/MfaPanel";
import { useMfaActions, useMfaState, type MfaEnrollment } from "@/lib/api/mfa";
import { logSecurityEvent, signOutOtherDevices } from "@/lib/api/security";
import { friendlyError } from "@/lib/api/errors";

/**
 * Double authentification de l'étudiant (application d'authentification, TOTP).
 * Une fois activée, la base refuse tout accès tant que le code n'a pas été saisi à la connexion (politique mfa_required).
 * Il n'existe pas de codes de secours : en cas de téléphone perdu, le support peut réinitialiser la vérification.
 */
export function TwoFactorPanel() {
  const state = useMfaState();
  const { enroll, verify, remove } = useMfaActions();
  const [pending, setPending] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  if (state.isPending) return <div className="grid place-items-center py-10"><Spinner /></div>;
  if (state.isError || !state.data) return <InlineAlert tone="danger" title="Impossible de lire l'état de la sécurité">Rechargez la page. Si le problème persiste, reconnectez-vous.</InlineAlert>;
  const factor = state.data.factors[0];

  const confirmEnrollment = (value: string) => {
    if (!pending || value.length !== 6 || verify.isPending) return;
    setError(null);
    verify.mutate({ factorId: pending.factorId, code: value }, {
      onSuccess: async () => {
        setPending(null);
        setCode("");
        void logSecurityEvent("mfa_enabled");
        try { await signOutOtherDevices(); } catch { /* sans gravité : ils seront bloqués par la base de toute façon */ }
        toast.success("Double authentification activée", { description: "Les autres appareils ont été déconnectés : ils devront saisir un code." });
      },
      onError: (e) => { setError(mfaErrorMessage(e)); setCode(""); },
    });
  };

  if (pending) {
    return (
      <SettingsCard title="Activer la double authentification" description="Ajoutez une deuxième étape à la connexion avec une application d'authentification.">
        <div className="mt-2 space-y-5">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Ouvrez une application d'authentification (Google Authenticator, Authy, Microsoft Authenticator…).</li>
            <li>Scannez ce QR code, ou saisissez la clé manuellement.</li>
            <li>Entrez le code à 6 chiffres affiché pour confirmer.</li>
          </ol>
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-4">
            <img src={pending.qrCode} alt="QR code à scanner avec votre application d'authentification" className="size-44 rounded-lg bg-white p-2" />
            <p className="text-xs text-muted-foreground">Clé de configuration manuelle</p>
            <code className="select-all break-all rounded bg-muted px-2 py-1 text-center text-xs font-semibold">{pending.secret}</code>
          </div>
          <OtpField value={code} onChange={(v) => { setCode(v); if (error) setError(null); }} onComplete={confirmEnrollment} invalid={error !== null} disabled={verify.isPending} />
          {error && <p role="alert" className="text-center text-sm text-destructive">{error}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" onClick={() => { setPending(null); setCode(""); setError(null); }}>Annuler</Button>
            <Button disabled={code.length !== 6 || verify.isPending} onClick={() => confirmEnrollment(code)}>{verify.isPending ? "Vérification…" : "Activer"}</Button>
          </div>
        </div>
      </SettingsCard>
    );
  }

  if (!factor) {
    return (
      <SettingsCard title="Double authentification" description="Protégez votre compte même si votre mot de passe est découvert.">
        <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
          {["Un code à 6 chiffres vous est demandé à chaque nouvelle connexion", "Sans ce code, personne ne peut accéder à votre compte, même avec votre mot de passe", "Gardez votre téléphone : il n'y a pas de codes de secours"].map((t) => <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{t}</li>)}
        </ul>
        <Button size="lg" className="mt-5 w-full" disabled={enroll.isPending} onClick={() => enroll.mutate(undefined, { onSuccess: setPending, onError: (e) => toast.error("Impossible de démarrer l'activation", { description: friendlyError(e) }) })}><ShieldCheck /> {enroll.isPending ? "Préparation…" : "Activer la double authentification"}</Button>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard title="Double authentification" description="Un code est demandé à chaque nouvelle connexion.">
      <InlineAlert tone="success" title="Activée" className="mt-2">Votre compte est protégé par une application d'authentification{factor.createdAt ? `, activée le ${new Date(factor.createdAt).toLocaleDateString("fr-FR")}` : ""}.</InlineAlert>
      <Button variant="outline" className="mt-4 w-full" disabled={remove.isPending} onClick={() => setConfirmRemove(factor.id)}>Désactiver la double authentification</Button>
      <ConfirmDialog open={confirmRemove !== null} onOpenChange={(o) => { if (!o) setConfirmRemove(null); }} destructive title="Désactiver la double authentification ?" description="Votre compte ne sera plus protégé que par votre mot de passe."
        confirmLabel="Désactiver" onConfirm={() => { if (confirmRemove) remove.mutate(confirmRemove, { onSuccess: () => { void logSecurityEvent("mfa_disabled"); toast.success("Double authentification désactivée"); }, onError: (e) => toast.error("Impossible de la désactiver", { description: friendlyError(e) }) }); }} />
    </SettingsCard>
  );
}
