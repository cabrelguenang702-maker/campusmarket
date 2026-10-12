import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Check, Desktop, Download, Eye, Moon, Pause, Search, Smartphone, Sun, UserX, Monitor, Lock, MessageCircle } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { ConfirmDialog, InlineAlert, LoadingButtonLabel, Spinner } from "@/components/cm/feedback";
import { Field, PasswordField } from "@/components/cm/forms";
import { SettingRow, SettingsCard } from "@/components/cm/setting-row";
import { setBlocked } from "@/lib/api/messages";
import { deactivateAccount, downloadMyData, saveVisibility, useBlockedUsers, useKnownDevices, useLoginHistory, useSignOutOthers, verifyPasswordIsolated, type LoginEvent, type VisibilitySettings } from "@/lib/api/security";
import { friendlyError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";
import { timeAgo } from "@/lib/domain";
import { useThemeState, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/* ---------- Général : apparence ---------- */
const themeOptions: { id: ThemeMode; label: string; icon: typeof Sun; swatch: string }[] = [
  { id: "light", label: "Clair", icon: Sun, swatch: "bg-[oklch(0.982_0.006_240)] text-[oklch(0.2_0.045_255)] border-[oklch(0.89_0.02_245)]" },
  { id: "dark", label: "Sombre", icon: Moon, swatch: "bg-[oklch(0.12_0.028_254)] text-[oklch(0.96_0.012_246)] border-[oklch(0.3_0.045_250)]" },
  { id: "system", label: "Automatique", icon: Monitor, swatch: "bg-gradient-to-r from-[oklch(0.982_0.006_240)] from-50% to-[oklch(0.12_0.028_254)] to-50% text-[oklch(0.5_0.1_240)] border-[oklch(0.6_0.04_245)]" },
];

/** L'interface n'existe qu'en français : pas de sélecteur de langue tant qu'une seconde langue n'est pas traduite. */
export function GeneralSection() {
  const { mode, setMode } = useThemeState();
  return (
    <div className="max-w-2xl space-y-5">
      <SettingsCard title="Apparence" description="Choisissez le thème de l'application. L'option automatique suit les réglages de votre appareil. Ce choix est enregistré sur cet appareil.">
        <div className="mt-2 grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Thème">
          {themeOptions.map(({ id, label, icon: Icon, swatch }) => (
            <button key={id} role="radio" aria-checked={mode === id} onClick={() => setMode(id)} className={cn("rounded-xl border-2 p-2 text-center transition", mode === id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
              <span className={cn("grid h-16 place-items-center rounded-lg border", swatch)}><Icon className="size-6" /></span>
              <span className="mt-2 flex items-center justify-center gap-1 text-xs font-semibold">{mode === id && <Check className="size-3.5 text-primary" />}{label}</span>
            </button>
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}

/* ---------- Confidentialité : ce qui est public, utilisateurs bloqués ---------- */
export function PrivacySection() {
  const { session, account, refreshAccount } = useAuth();
  const userId = session?.user.id;
  const [savingKey, setSavingKey] = useState<keyof VisibilitySettings | null>(null);
  const discoverable = account?.profile.discoverable ?? true;
  const allowStrangers = account?.private?.allowStrangerMessages ?? true;
  const change = async (key: keyof VisibilitySettings, value: boolean) => {
    if (!userId) return;
    setSavingKey(key);
    try { await saveVisibility(userId, key === "discoverable" ? { discoverable: value } : { allowStrangerMessages: value }); await refreshAccount(); toast.success("Réglage enregistré"); }
    catch (e) { toast.error("Réglage non enregistré", { description: friendlyError(e) }); await refreshAccount(); }
    finally { setSavingKey(null); }
  };
  const qc = useQueryClient();
  const blocked = useBlockedUsers(userId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const unblock = async (id: string) => {
    if (!userId) return;
    setBusyId(id);
    try { await setBlocked(userId, id, false); await qc.invalidateQueries({ queryKey: ["blocked-users", userId] }); toast.success("Utilisateur débloqué"); }
    catch (e) { toast.error("Déblocage impossible", { description: friendlyError(e) }); }
    finally { setBusyId(null); }
  };
  return (
    <div className="max-w-2xl space-y-5">
      <SettingsCard title="Ce que les autres voient" description="Voici comment votre compte est partagé aujourd'hui.">
        <ul className="mt-2 divide-y divide-border">
          <li className="flex items-start gap-3 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-primary"><Eye className="size-5" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Visible par les autres étudiants</span><span className="block text-xs text-muted-foreground">Nom, photo, présentation, université, filière, annonces en ligne, avis reçus et badge de vérification.</span></span></li>
          <li className="flex items-start gap-3 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-primary"><Lock className="size-5" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Privé</span><span className="block text-xs text-muted-foreground">Adresse e-mail, téléphone, justificatifs de vérification, achats et conversations.</span></span></li>
          <li className="flex items-start gap-3 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-primary"><MessageCircle className="size-5" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Messages</span><span className="block text-xs text-muted-foreground">Vous pouvez bloquer un utilisateur depuis une conversation : il ne peut plus vous écrire.</span></span></li>
        </ul>
      </SettingsCard>
      <SettingsCard title="Vos réglages" description="Ils s'appliquent immédiatement.">
        <SettingRow id="pv-search" icon={Search} label="Apparaître dans la recherche de personnes" description="Si désactivé, on ne peut pas vous trouver par votre nom. Votre profil reste visible depuis vos annonces." checked={discoverable} disabled={savingKey !== null || !account} onCheckedChange={(v) => void change("discoverable", v)} />
        <div className="border-t border-border" />
        <SettingRow id="pv-msg" icon={MessageCircle} label="Messages privés d'inconnus" description="Si désactivé, seuls vos abonnés peuvent vous écrire hors annonce. Les acheteurs peuvent toujours vous contacter à propos de vos annonces." checked={allowStrangers} disabled={savingKey !== null || !account} onCheckedChange={(v) => void change("allowStrangerMessages", v)} />
      </SettingsCard>
      <SettingsCard title="Utilisateurs bloqués">
        {blocked.isPending ? <div className="grid place-items-center py-6"><Spinner className="size-5" /></div>
          : blocked.isError ? <p className="py-3 text-sm text-muted-foreground">Impossible de charger la liste. <button className="font-semibold text-primary hover:underline" onClick={() => void blocked.refetch()}>Réessayer</button></p>
          : (blocked.data ?? []).length === 0 ? <SettingRow id="pv-blocked" icon={UserX} label="Aucun utilisateur bloqué" description="Les personnes que vous bloquez apparaissent ici." />
          : <ul className="divide-y divide-border">{(blocked.data ?? []).map((u) => <li key={u.id} className="flex items-center gap-3 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-primary"><UserX className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{u.name}</span><span className="block text-xs text-muted-foreground">Bloqué {timeAgo(u.since)}</span></span><Button size="sm" variant="outline" disabled={busyId === u.id} onClick={() => void unblock(u.id)}>Débloquer</Button></li>)}</ul>}
      </SettingsCard>
    </div>
  );
}

/* ---------- Appareils et historique de connexion ---------- */
const eventLabel: Record<LoginEvent["type"], { what: string; tone: "success" | "warning" | "info" }> = {
  login_success: { what: "Connexion", tone: "success" },
  new_device_detected: { what: "Nouvel appareil détecté", tone: "warning" },
  password_changed: { what: "Mot de passe modifié", tone: "info" },
  mfa_enabled: { what: "Double authentification activée", tone: "info" },
  mfa_disabled: { what: "Double authentification désactivée", tone: "warning" },
};

export function DevicesSection({ initialConfirm = false }: { initialConfirm?: boolean }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const devices = useKnownDevices(userId);
  const history = useLoginHistory(userId);
  const signOutOthers = useSignOutOthers();
  const [confirm, setConfirm] = useState(initialConfirm);
  const list = devices.data ?? [];
  return (
    <div className="max-w-2xl space-y-5">
      <SettingsCard title="Appareils connus" description="Les appareils depuis lesquels vous vous êtes connecté. Si vous n'en reconnaissez pas un, changez votre mot de passe et déconnectez les autres appareils.">
        {devices.isPending ? <div className="grid place-items-center py-6"><Spinner className="size-5" /></div>
          : devices.isError ? <p className="py-3 text-sm text-muted-foreground">Impossible de charger les appareils. <button className="font-semibold text-primary hover:underline" onClick={() => void devices.refetch()}>Réessayer</button></p>
          : list.length === 0 ? <p className="py-3 text-sm text-muted-foreground">Aucun appareil enregistré pour le moment. Il apparaîtra à votre prochaine connexion.</p>
          : <ul className="mt-2 divide-y divide-border">{list.map((d) => {
              const Icon = /Android|iOS/.test(d.label) ? Smartphone : Desktop;
              return <li key={d.id} className="flex items-center gap-3 py-3.5"><span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent text-primary"><Icon className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{d.label}</span><span className="block text-xs text-muted-foreground">Dernière activité {timeAgo(d.lastSeenAt)}</span></span>{d.current && <Pill tone="success">Cet appareil</Pill>}</li>;
            })}</ul>}
        <Button variant="outline" className="mt-2 w-full" onClick={() => setConfirm(true)}>Déconnecter tous les autres appareils</Button>
      </SettingsCard>

      <SettingsCard title="Historique" description="Les 30 derniers jours.">
        {history.isPending ? <div className="grid place-items-center py-6"><Spinner className="size-5" /></div>
          : history.isError ? <p className="py-3 text-sm text-muted-foreground">Impossible de charger l'historique. <button className="font-semibold text-primary hover:underline" onClick={() => void history.refetch()}>Réessayer</button></p>
          : (history.data ?? []).length === 0 ? <p className="py-3 text-sm text-muted-foreground">Aucun événement récent.</p>
          : <ul className="mt-2 divide-y divide-border">{(history.data ?? []).map((l) => {
              const meta = eventLabel[l.type];
              return <li key={l.id} className="flex items-center gap-3 py-3"><span className={cn("grid size-9 shrink-0 place-items-center rounded-md", meta.tone === "success" ? "bg-success/15 text-success" : meta.tone === "warning" ? "bg-warning/15 text-warning" : "bg-accent text-primary")}><Check className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{meta.what}</span><span className="block text-xs text-muted-foreground">{timeAgo(l.at)}{l.device ? ` · ${l.device}` : ""}</span></span></li>;
            })}</ul>}
        <InlineAlert tone="warning" className="mt-3" title="Une activité inconnue ?">Changez votre mot de passe sans attendre. <AppLink to="/profil/parametres" search={{ section: "securite" }} className="font-semibold underline">Aller à la sécurité</AppLink></InlineAlert>
      </SettingsCard>

      <ConfirmDialog open={confirm} onOpenChange={setConfirm} destructive title="Déconnecter les autres appareils ?" description="Tous les appareils sauf celui-ci seront déconnectés. Ils devront se reconnecter avec votre mot de passe."
        confirmLabel="Déconnecter"
        onConfirm={() => signOutOthers.mutate(undefined, { onSuccess: () => toast.success("Les autres appareils ont été déconnectés"), onError: (e) => toast.error("Déconnexion impossible", { description: friendlyError(e) }) })} />
    </div>
  );
}

/* ---------- Compte : export, désactivation ---------- */
function DeactivateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { account, refreshAccount } = useAuth();
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const email = account?.private?.email ?? "";
  const close = (o: boolean) => { if (busy) return; if (!o) { setPassword(""); setReason(""); setError(undefined); } onOpenChange(o); };
  const submit = async () => {
    if (!password) return setError("Saisissez votre mot de passe pour confirmer.");
    setBusy(true);
    setError(undefined);
    try {
      if ((await verifyPasswordIsolated(email, password)) === "wrong") { setError("Mot de passe incorrect."); return; }
      await deactivateAccount(reason);
      await refreshAccount(); // l'application bascule d'elle-même sur l'écran « compte désactivé »
    } catch (e) {
      toast.error("Désactivation impossible", { description: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display">Désactiver mon compte</DialogTitle><DialogDescription>Votre profil, vos annonces et vos demandes seront masqués aux autres étudiants. Vos données sont conservées et vous pouvez réactiver votre compte à tout moment en vous reconnectant.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <InlineAlert tone="warning">Vos commandes en cours restent actives : pensez à les finaliser avant de partir.</InlineAlert>
          <Field label="Pourquoi partez-vous ? (facultatif)" htmlFor="deact-reason"><Textarea id="deact-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Field label="Mot de passe" htmlFor="deact-pw" error={error}><PasswordField id="deact-pw" autoComplete="current-password" value={password} invalid={!!error} onChange={(e) => { setPassword(e.target.value); setError(undefined); }} /></Field>
        </div>
        <DialogFooter className="gap-2 sm:gap-2"><Button variant="outline" disabled={busy} onClick={() => close(false)}>Annuler</Button><Button variant="destructive" disabled={busy} onClick={() => void submit()}><LoadingButtonLabel loading={busy} loadingText="Désactivation…">Désactiver mon compte</LoadingButtonLabel></Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AccountSection() {
  const [exporting, setExporting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const exportData = async () => {
    setExporting(true);
    try { await downloadMyData(); toast.success("Export prêt", { description: "Le fichier a été téléchargé sur votre appareil." }); }
    catch (e) { toast.error("Export impossible", { description: friendlyError(e) }); }
    finally { setExporting(false); }
  };
  return (
    <div className="max-w-2xl space-y-5">
      <SettingsCard title="Mes données" description="Téléchargez une copie de vos données personnelles : profil, annonces, commandes, offres, avis, messages envoyés, notifications… (fichier JSON). Limité à 3 exports par heure.">
        <Button variant="outline" className="mt-2" disabled={exporting} onClick={() => void exportData()}><Download /><LoadingButtonLabel loading={exporting} loadingText="Préparation…">Télécharger mes données</LoadingButtonLabel></Button>
      </SettingsCard>
      <SettingsCard title="Désactiver mon compte" description="Une pause, pas un adieu : tout est conservé et vous pouvez revenir quand vous voulez.">
        <SettingRow id="acc-deactivate" icon={Pause} label="Masquer mon profil et mes annonces" description="Réversible à tout moment en vous reconnectant." action={<Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeactivating(true)}>Désactiver</Button>} />
      </SettingsCard>
      <SettingsCard title="Suppression définitive">
        <p className="text-sm text-muted-foreground">La suppression définitive du compte et des données se fait sur demande auprès de notre équipe. <AppLink to="/aide" className="font-semibold text-primary hover:underline">Contacter le support</AppLink></p>
      </SettingsCard>
      <DeactivateDialog open={deactivating} onOpenChange={setDeactivating} />
    </div>
  );
}
