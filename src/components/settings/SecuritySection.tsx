import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, Devices, Lock, ShieldCheck } from "@/components/icons";
import { InlineAlert, LoadingButtonLabel } from "@/components/cm/feedback";
import { Field, PasswordField, PasswordStrength } from "@/components/cm/forms";
import { Pill } from "@/components/cm/badges";
import { SettingRow, SettingsCard } from "@/components/cm/setting-row";
import { TwoFactorPanel } from "@/components/settings/TwoFactorPanel";
import { useMfaState } from "@/lib/api/mfa";
import { changePassword } from "@/lib/api/security";
import { friendlyError } from "@/lib/api/errors";
import { passwordRuleResults, isStrongPassword } from "@/lib/auth-utils";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export type SecuritySub = "menu" | "mdp" | "2fa";

function Back({ onClick, label = "Retour à la sécurité" }: { onClick: () => void; label?: string }) {
  return <button onClick={onClick} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-[18px]" /> {label}</button>;
}

/** Changer le mot de passe : l'ancien est revérifié côté Supabase avant d'accepter le nouveau. */
function ChangePassword({ onDone }: { onDone: () => void }) {
  const { account } = useAuth();
  const email = account?.private?.email ?? "";
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [saving, setSaving] = useState(false);
  const rules = passwordRuleResults(next);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err: typeof errors = {};
    if (!current) err.current = "Saisissez votre mot de passe actuel.";
    if (!isStrongPassword(next)) err.next = "Le nouveau mot de passe ne respecte pas toutes les règles.";
    else if (next === current) err.next = "Choisissez un mot de passe différent de l'actuel.";
    if (confirm !== next) err.confirm = "Les deux mots de passe ne sont pas identiques.";
    setErrors(err);
    if (Object.keys(err).length || !email) return;
    setSaving(true);
    try {
      const result = await changePassword(email, current, next);
      if (result === "wrong_current") { setErrors({ current: "Le mot de passe actuel est incorrect." }); return; }
      toast.success("Mot de passe modifié", { description: "Pour plus de sécurité, déconnectez les autres appareils depuis « Appareils »." });
      onDone();
    } catch (error) {
      toast.error("Mot de passe non modifié", { description: friendlyError(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <Back onClick={onDone} />
      <SettingsCard title="Changer le mot de passe" description="Utilisez un mot de passe unique, que vous n'utilisez pas ailleurs.">
        <form onSubmit={(e) => void submit(e)} noValidate className="mt-2 space-y-4">
          <Field label="Mot de passe actuel" htmlFor="pw-cur" error={errors.current}><PasswordField id="pw-cur" autoComplete="current-password" value={current} invalid={!!errors.current} onChange={(e) => setCurrent(e.target.value)} /></Field>
          <Field label="Nouveau mot de passe" htmlFor="pw-new" error={errors.next}><PasswordField id="pw-new" autoComplete="new-password" value={next} invalid={!!errors.next} onChange={(e) => setNext(e.target.value)} /></Field>
          <PasswordStrength value={next} />
          <ul className="grid gap-1.5 text-xs">{rules.map(({ label, ok }) => <li key={label} className={cn("flex items-center gap-2", ok ? "text-success" : "text-muted-foreground")}><span className={cn("grid size-4 place-items-center rounded-full", ok ? "bg-success/15" : "bg-muted")}>{ok && <Check className="size-3" />}</span>{label}</li>)}</ul>
          <Field label="Confirmer le nouveau mot de passe" htmlFor="pw-conf" error={errors.confirm}><PasswordField id="pw-conf" autoComplete="new-password" value={confirm} invalid={!!errors.confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          <Button type="submit" size="lg" className="w-full" disabled={saving}><LoadingButtonLabel loading={saving} loadingText="Enregistrement…">Enregistrer le mot de passe</LoadingButtonLabel></Button>
        </form>
      </SettingsCard>
    </div>
  );
}

export function SecuritySection({ sub, setSub, goDevices }: { sub: SecuritySub; setSub: (s: SecuritySub) => void; goDevices: () => void }) {
  const mfa = useMfaState();
  if (sub === "mdp") return <ChangePassword onDone={() => setSub("menu")} />;
  if (sub === "2fa") return <div className="max-w-xl"><Back onClick={() => setSub("menu")} /><TwoFactorPanel /></div>;
  const enabled = (mfa.data?.factors.length ?? 0) > 0;
  return (
    <div className="max-w-2xl space-y-5">
      <SettingsCard>
        <SettingRow id="sec-pw" icon={Lock} label="Mot de passe" description="Changez-le régulièrement et ne le réutilisez pas ailleurs." action={<Button variant="outline" size="sm" onClick={() => setSub("mdp")}>Modifier</Button>} />
        <div className="border-t border-border" />
        <SettingRow id="sec-2fa" icon={ShieldCheck} label="Double authentification" description="Un code de votre téléphone est demandé à la connexion." action={<div className="flex items-center gap-2">{mfa.data && <Pill tone={enabled ? "success" : "neutral"}>{enabled ? "Activée" : "Désactivée"}</Pill>}<Button variant="outline" size="sm" onClick={() => setSub("2fa")}>{enabled ? "Gérer" : "Activer"}</Button></div>} />
        <div className="border-t border-border" />
        <SettingRow id="sec-dev" icon={Devices} label="Appareils et connexions" description="Consultez vos appareils et l'historique des 30 derniers jours." action={<Button variant="outline" size="sm" onClick={goDevices}>Voir</Button>} />
      </SettingsCard>
      <InlineAlert tone="info" title="Conseil de sécurité">Ne partagez jamais votre mot de passe ni vos codes de vérification : l'équipe CampusMarket ne vous les demandera jamais.</InlineAlert>
    </div>
  );
}
