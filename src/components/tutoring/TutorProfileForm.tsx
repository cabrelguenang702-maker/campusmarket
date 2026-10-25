import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/cm/forms";
import { InlineAlert } from "@/components/cm/feedback";
import { ServerErrorScreen } from "@/components/cm/screens";
import { friendlyError } from "@/lib/api/errors";
import { MODE_LABEL, useMyTutorProfile, usePaidTutoring, useTutoringActions, type TutorMode } from "@/lib/api/tutoring";
import { useAuth } from "@/lib/auth";
import { Stars } from "./Stars";

/** « maths, physique » -> ["maths", "physique"] (virgules, points-virgules et retours à la ligne ; doublons ignorés). */
function parseSubjects(text: string): string[] {
  const seen = new Set<string>();
  return text.split(/[,;\n]/).map((s) => s.trim()).filter((s) => {
    const k = s.toLowerCase();
    if (!s || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function TutorProfileForm() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const profile = useMyTutorProfile(userId);
  const paid = usePaidTutoring();
  const acts = useTutoringActions();
  const [subjects, setSubjects] = useState("");
  const [bio, setBio] = useState("");
  const [availability, setAvailability] = useState("");
  const [mode, setMode] = useState<TutorMode>("both");
  const [price, setPrice] = useState("");
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  useEffect(() => {
    if (profile.isPending) return;
    const p = profile.data;
    setSubjects(p ? p.subjects.join(", ") : ""); setBio(p?.bio ?? ""); setAvailability(p?.availability ?? ""); setMode(p?.mode ?? "both");
    setPrice(p && p.hourlyPrice > 0 ? String(p.hourlyPrice) : ""); setActive(p?.active ?? true);
  }, [profile.data, profile.isPending]);

  if (profile.isPending) return <div aria-busy className="h-48 animate-pulse rounded-xl bg-foreground/10" />;
  if (profile.isError) return <ServerErrorScreen compact onRetry={() => void profile.refetch()} />;
  const existing = profile.data;
  const paidEnabled = paid.data === true;

  const submit = async () => {
    const list = parseSubjects(subjects);
    if (list.length < 1 || list.length > 8 || list.some((s) => s.length < 2 || s.length > 60)) return setError("Indiquez de 1 à 8 matières, séparées par des virgules (2 à 60 caractères chacune).");
    if (bio.length > 500) return setError("La présentation est limitée à 500 caractères.");
    if (availability.length > 300) return setError("Les disponibilités sont limitées à 300 caractères.");
    const p = price.trim() === "" ? 0 : Number(price.replace(/\s/g, ""));
    if (!Number.isInteger(p) || (p !== 0 && (p < 500 || p > 50000))) return setError("Prix horaire : de 500 à 50 000 FCFA, ou vide pour des séances gratuites.");
    setError(null); setNeedsVerification(false);
    try {
      await acts.saveProfile.mutateAsync({ subjects: list, bio, availability, mode, active, hourlyPrice: paidEnabled ? p : 0 });
      toast.success(existing ? "Profil tuteur mis à jour." : "Vous êtes maintenant tuteur.");
    } catch (e) {
      const msg = friendlyError(e, "Enregistrement impossible. Réessayez dans un instant.");
      setNeedsVerification(msg.includes("vérifiés"));
      setError(msg);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <InlineAlert tone="info" title={existing ? "Votre profil tuteur" : "Devenir tuteur"}>
        Aidez d'autres étudiants sur les matières que vous maîtrisez. Un profil vérifié est nécessaire pour être visible dans l'annuaire.
        {existing && existing.reviewsCount > 0 && <span className="mt-1 block"><Stars value={existing.rating} /> {existing.rating.toFixed(1)} ({existing.reviewsCount} avis) · {existing.sessionsCount} séance{existing.sessionsCount > 1 ? "s" : ""}</span>}
      </InlineAlert>
      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <Field label="Matières que vous enseignez" htmlFor="tp-subjects" hint="Séparées par des virgules, 8 au maximum. Ex. : Mathématiques, Physique, Statistiques">
          <Input id="tp-subjects" value={subjects} onChange={(e) => setSubjects(e.target.value)} />
        </Field>
        <Field label="Présentation (facultatif)" htmlFor="tp-bio"><Textarea id="tp-bio" rows={4} maxLength={500} placeholder="Votre parcours, votre façon d'aider" value={bio} onChange={(e) => setBio(e.target.value)} /></Field>
        <Field label="Disponibilités (facultatif)" htmlFor="tp-avail"><Textarea id="tp-avail" rows={2} maxLength={300} placeholder="Ex. Soirs en semaine, samedi matin" value={availability} onChange={(e) => setAvailability(e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mode des séances" htmlFor="tp-mode">
            <Select value={mode} onValueChange={(v) => setMode(v as TutorMode)}>
              <SelectTrigger id="tp-mode" className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(MODE_LABEL) as TutorMode[]).map((m) => <SelectItem key={m} value={m}>{MODE_LABEL[m]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {paidEnabled ? (
            <Field label="Prix par heure (FCFA)" htmlFor="tp-price" hint="Vide = séances gratuites. CampusMarket retient une commission sur les séances payantes.">
              <Input id="tp-price" inputMode="numeric" placeholder="Gratuit" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
          ) : (
            <div className="rounded-lg bg-secondary p-3 text-sm text-muted-foreground">Les séances sont gratuites pour le moment. Les séances payantes seront ouvertes plus tard.</div>
          )}
        </div>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <span><span className="block font-semibold">Visible dans l'annuaire</span><span className="text-xs text-muted-foreground">Désactivez pour mettre votre profil en pause sans le supprimer.</span></span>
          <Switch checked={active} onCheckedChange={setActive} aria-label="Visible dans l'annuaire" />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}{needsVerification && <> <Link to="/profil/verification" className="font-semibold underline">Vérifier mon profil</Link></>}</p>}
        <div className="flex justify-end"><Button onClick={() => void submit()} disabled={acts.saveProfile.isPending}>{acts.saveProfile.isPending ? "Enregistrement…" : existing ? "Enregistrer" : "Devenir tuteur"}</Button></div>
      </div>
    </div>
  );
}
