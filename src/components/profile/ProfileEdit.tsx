import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, BadgeCheck, Camera, ImageIcon, Lock, Trash } from "@/components/icons";
import { Avatar } from "@/components/cm/commerce";
import { InlineAlert, LoadingButtonLabel } from "@/components/cm/feedback";
import { Field, IconInput } from "@/components/cm/forms";
import { SettingsCard } from "@/components/cm/setting-row";
import { AVATAR_MAX_BYTES, AVATAR_TYPES, useProfileMutations } from "@/lib/api/profile";
import { requestEmailChange } from "@/lib/api/security";
import { friendlyError } from "@/lib/api/errors";
import { isValidEmail } from "@/lib/auth-utils";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

function useOwn() {
  const { account, session, refreshAccount } = useAuth();
  const userId = session?.user.id;
  return { account, userId, mutations: useProfileMutations(userId, refreshAccount) };
}

/** Boîte de dialogue « Modifier la photo » : choix d'un fichier (galerie ou appareil photo), aperçu, envoi, suppression. */
export function PhotoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { account, mutations } = useOwn();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const current = account?.profile.avatarUrl ?? null;
  const shown = removing ? null : preview ?? current;
  const busy = mutations.uploadPhoto.isPending || mutations.removePhoto.isPending;

  const reset = () => { if (preview) URL.revokeObjectURL(preview); setFile(null); setPreview(null); setRemoving(false); };
  const close = (o: boolean) => { if (!o) reset(); onOpenChange(o); };
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!AVATAR_TYPES.includes(f.type)) return void toast.error("Format non pris en charge", { description: "JPG, PNG ou WebP." });
    if (f.size > AVATAR_MAX_BYTES) return void toast.error("Photo trop lourde", { description: "Maximum 2 Mo." });
    if (preview) URL.revokeObjectURL(preview);
    setFile(f); setPreview(URL.createObjectURL(f)); setRemoving(false);
  };
  const save = () => {
    const onError = (e: unknown) => toast.error("Photo non enregistrée", { description: e instanceof Error && !("code" in e) ? e.message : friendlyError(e) });
    if (file) mutations.uploadPhoto.mutate(file, { onSuccess: () => { toast.success("Photo mise à jour"); close(false); }, onError });
    else if (removing) mutations.removePhoto.mutate(undefined, { onSuccess: () => { toast.success("Photo supprimée"); close(false); }, onError });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-display">Modifier la photo</DialogTitle><DialogDescription>Une photo de vous rassure acheteurs et vendeurs. JPG, PNG ou WebP, 2 Mo maximum. Elle est visible par tous.</DialogDescription></DialogHeader>
        <div className="flex justify-center py-2"><Avatar name={account?.profile.fullName ?? ""} size="xl" src={shown} className="size-32 text-4xl" /></div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="user" className="sr-only" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="grid gap-2">
          <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}><ImageIcon /> Choisir dans la galerie</Button>
          <Button variant="outline" disabled={busy} onClick={() => cameraRef.current?.click()}><Camera /> Prendre une photo</Button>
          <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy || (!current && !preview)} onClick={() => { if (preview) URL.revokeObjectURL(preview); setFile(null); setPreview(null); setRemoving(!!current); }}><Trash /> Supprimer la photo</Button>
        </div>
        <DialogFooter className="gap-2 sm:gap-2"><Button variant="outline" disabled={busy} onClick={() => close(false)}>Annuler</Button><Button disabled={busy || (!file && !removing)} onClick={save}><LoadingButtonLabel loading={busy} loadingText="Envoi…">Enregistrer</LoadingButtonLabel></Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Modifier le profil : identité publique. */
export function EditProfile({ onPhoto, onDone, onInfos }: { onPhoto: () => void; onDone: () => void; onInfos: () => void }) {
  const { account, mutations } = useOwn();
  const p = account?.profile;
  const [name, setName] = useState(p?.fullName ?? "");
  const [bio, setBio] = useState(p?.bio ?? "");
  const [filiere, setFiliere] = useState(p?.filiere ?? "");
  const [niveau, setNiveau] = useState(p?.niveau ?? "");
  const [ville, setVille] = useState(p?.city ?? "");
  const nameError = name.trim().length < 2 ? "Saisissez un nom d'au moins 2 caractères." : undefined;
  const saving = mutations.save.isPending;
  const submit = () => mutations.save.mutate({ fullName: name, bio, filiere, niveau, city: ville }, {
    onSuccess: () => { toast.success("Profil mis à jour"); onDone(); },
    onError: (e) => toast.error("Profil non enregistré", { description: friendlyError(e) }),
  });
  return (
    <div className="max-w-2xl">
      <button onClick={onDone} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-[18px]" /> Retour au profil</button>
      <SettingsCard title="Modifier le profil" description="Ces informations sont visibles par les autres étudiants.">
        <div className="mt-2 flex items-center gap-4">
          <button onClick={onPhoto} aria-label="Modifier la photo" className="group relative rounded-full"><Avatar name={name} size="xl" src={p?.avatarUrl} /><span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"><Camera className="size-6" /></span></button>
          <div><Button variant="outline" size="sm" onClick={onPhoto}><Camera /> Modifier la photo</Button><p className="mt-1.5 text-xs text-muted-foreground">JPG, PNG ou WebP, 2 Mo maximum.</p></div>
        </div>
        <div className="mt-6 space-y-5">
          <Field label="Nom affiché" htmlFor="ep-name" error={nameError}><IconInput id="ep-name" maxLength={80} value={name} invalid={!!nameError} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="À propos de vous" htmlFor="ep-bio" hint={`${bio.length} / 300 caractères`}><Textarea id="ep-bio" maxLength={300} value={bio} onChange={(e) => setBio(e.target.value)} /></Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Filière" htmlFor="ep-fil"><IconInput id="ep-fil" maxLength={80} value={filiere} onChange={(e) => setFiliere(e.target.value)} /></Field>
            <Field label="Niveau" htmlFor="ep-niv"><IconInput id="ep-niv" maxLength={40} value={niveau} onChange={(e) => setNiveau(e.target.value)} /></Field>
          </div>
          <Field label="Ville" htmlFor="ep-ville"><IconInput id="ep-ville" maxLength={80} value={ville} onChange={(e) => setVille(e.target.value)} /></Field>
        </div>
        <div className="mt-6 flex flex-wrap gap-2.5"><Button size="lg" disabled={saving || !!nameError || !p} onClick={submit}><LoadingButtonLabel loading={saving} loadingText="Enregistrement…">Enregistrer</LoadingButtonLabel></Button><Button size="lg" variant="outline" onClick={onDone}>Annuler</Button></div>
      </SettingsCard>
      <button onClick={onInfos} className="mt-4 text-sm font-semibold text-primary hover:underline">Mes informations personnelles →</button>
    </div>
  );
}

/** Informations personnelles (privées) : e-mail modifiable avec confirmation, téléphone et université en lecture seule. */
export function PersonalInfo({ onDone }: { onDone: () => void }) {
  const { account } = useOwn();
  const current = account?.private?.email ?? "";
  const [email, setEmail] = useState(current);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const changed = email.trim().toLowerCase() !== current.toLowerCase();
  const emailError = isValidEmail(email) ? undefined : "Saisissez une adresse e-mail valide.";
  const phone = account?.private?.phone;
  const submit = async () => {
    setSaving(true);
    try { await requestEmailChange(email); setSent(true); toast.success("Confirmation envoyée", { description: "Ouvrez le lien reçu à la nouvelle adresse pour valider le changement." }); }
    catch (e) { toast.error("Changement impossible", { description: friendlyError(e) }); }
    finally { setSaving(false); }
  };
  return (
    <div className="max-w-2xl">
      <button onClick={onDone} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-[18px]" /> Retour au profil</button>
      <SettingsCard title="Informations personnelles" description="Ces informations restent privées et servent à sécuriser votre compte.">
        <div className="mt-2 space-y-5">
          <Field label="Adresse e-mail" htmlFor="pi-mail" error={changed ? emailError : undefined} hint="Un lien de confirmation est envoyé à la nouvelle adresse. L'ancienne reste valable jusqu'à confirmation."><IconInput id="pi-mail" type="email" value={email} invalid={changed && !!emailError} onChange={(e) => { setEmail(e.target.value); setSent(false); }} /></Field>
          <Field label="Téléphone" htmlFor="pi-phone" hint={phone ? (account?.private?.phoneVerified ? "Numéro vérifié." : "Numéro non vérifié.") : "Aucun numéro enregistré."}><IconInput id="pi-phone" icon={Lock} readOnly value={phone ?? ""} placeholder="Non renseigné" className="bg-muted/60" /></Field>
          <Field label="Université" htmlFor="pi-univ"><IconInput id="pi-univ" icon={Lock} readOnly value={account?.profile.campus ?? ""} placeholder="Non renseignée" className="bg-muted/60" /></Field>
          <InlineAlert tone="info">Le numéro de téléphone et l'université ne se modifient pas ici. <a href="/aide" className="font-semibold underline">Contacter le support</a></InlineAlert>
          {sent && <InlineAlert tone="success" title="Vérifiez votre boîte mail">Le changement sera effectif une fois le lien ouvert.</InlineAlert>}
        </div>
        <div className="mt-6 flex flex-wrap gap-2.5"><Button size="lg" disabled={saving || !changed || !!emailError || sent} onClick={() => void submit()}><LoadingButtonLabel loading={saving} loadingText="Envoi…">Changer l'adresse e-mail</LoadingButtonLabel></Button><Button size="lg" variant="outline" onClick={onDone}>Retour</Button></div>
      </SettingsCard>
    </div>
  );
}

export function VerifiedNote({ className }: { className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 text-xs font-semibold text-primary", className)}><BadgeCheck className="size-4" /> Compte vérifié</span>;
}
