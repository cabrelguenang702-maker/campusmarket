import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { OtpField } from "@/components/cm/forms";
import { ConfirmDialog, InlineAlert, Spinner } from "@/components/cm/feedback";
import { ShieldCheck } from "@/components/icons";
import { useMfaActions, useMfaState, type MfaEnrollment } from "@/lib/api/mfa";

/** Message lisible pour les échecs courants d'un code TOTP (code erroné ou expiré, trop d'essais). */
export function mfaErrorMessage(error: unknown): string {
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : "";
  if (/rate|too many/i.test(message)) return "Trop de tentatives. Patientez une minute puis réessayez.";
  if (/invalid|expired|incorrect/i.test(message)) return "Code incorrect ou expiré. Vérifiez l'heure de votre téléphone et réessayez.";
  return "La vérification a échoué. Réessayez dans un instant.";
}

/** Saisie du code d'une application d'authentification déjà activée (élève la session à aal2). */
export function MfaChallenge({ factorId, onDone }: { factorId: string; onDone?: () => void }) {
  const { verify } = useMfaActions();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (value: string) => {
    if (value.length !== 6 || verify.isPending) return;
    setError(null);
    verify.mutate({ factorId, code: value }, {
      onSuccess: () => { toast.success("Session sécurisée"); setCode(""); onDone?.(); },
      onError: (e) => { setError(mfaErrorMessage(e)); setCode(""); },
    });
  };

  return (
    <div className="space-y-3">
      <OtpField value={code} onChange={(v) => { setCode(v); if (error) setError(null); }} onComplete={submit} invalid={error !== null} disabled={verify.isPending} />
      {error && <p role="alert" className="text-center text-sm text-destructive">{error}</p>}
      <Button className="w-full" disabled={code.length !== 6 || verify.isPending} onClick={() => submit(code)}>{verify.isPending ? "Vérification…" : "Vérifier le code"}</Button>
    </div>
  );
}

/** Activation, vérification et retrait de l'authentification à deux facteurs de l'utilisateur connecté. */
export function MfaPanel() {
  const state = useMfaState();
  const { enroll, remove } = useMfaActions();
  const [pending, setPending] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const { verify } = useMfaActions();

  if (state.isLoading) return <div className="grid place-items-center py-10"><Spinner /></div>;
  if (state.isError || !state.data) return <InlineAlert tone="danger" title="Impossible de lire l'état de la sécurité">Rechargez la page. Si le problème persiste, reconnectez-vous.</InlineAlert>;

  const factor = state.data.factors[0];
  const secured = state.data.currentLevel === "aal2";

  const confirmEnrollment = (value: string) => {
    if (!pending || value.length !== 6 || verify.isPending) return;
    setError(null);
    verify.mutate({ factorId: pending.factorId, code: value }, {
      onSuccess: () => { toast.success("Double authentification activée"); setPending(null); setCode(""); },
      onError: (e) => { setError(mfaErrorMessage(e)); setCode(""); },
    });
  };

  if (pending) {
    return (
      <div className="space-y-5">
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
    );
  }

  if (!factor) {
    return (
      <div className="space-y-4">
        <InlineAlert tone="warning" title="Double authentification non activée">Sans elle, les actions sensibles (bannissement, rôles, modération) sont refusées par la base.</InlineAlert>
        <Button size="lg" className="w-full" disabled={enroll.isPending} onClick={() => enroll.mutate(undefined, { onSuccess: setPending, onError: () => toast.error("Impossible de démarrer l'activation. Réessayez.") })}><ShieldCheck /> {enroll.isPending ? "Préparation…" : "Activer la double authentification"}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {secured
        ? <InlineAlert tone="success" title="Session sécurisée">Votre code a été vérifié pour cette session : les actions sensibles sont autorisées.</InlineAlert>
        : <InlineAlert tone="warning" title="Code requis pour cette session">Saisissez le code de votre application d'authentification pour débloquer les actions sensibles.</InlineAlert>}
      {!secured && <MfaChallenge factorId={factor.id} />}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm">
        <div><p className="font-semibold">Application d'authentification</p><p className="text-xs text-muted-foreground">Activée le {new Date(factor.createdAt).toLocaleDateString("fr-FR")}</p></div>
        <Button variant="outline" size="sm" disabled={remove.isPending || !secured} onClick={() => setConfirmRemove(factor.id)}>Retirer</Button>
      </div>
      {!secured && <p className="text-xs text-muted-foreground">Pour retirer ce facteur, vérifiez d'abord votre code.</p>}
      <ConfirmDialog open={confirmRemove !== null} onOpenChange={(o) => { if (!o) setConfirmRemove(null); }} destructive title="Retirer la double authentification ?" description="Les actions sensibles du back-office seront refusées tant que vous n'en aurez pas activé une nouvelle."
        confirmLabel="Retirer" onConfirm={() => { if (confirmRemove) remove.mutate(confirmRemove, { onSuccess: () => toast.success("Double authentification retirée"), onError: () => toast.error("Impossible de la retirer. Réessayez.") }); }} />
    </div>
  );
}
