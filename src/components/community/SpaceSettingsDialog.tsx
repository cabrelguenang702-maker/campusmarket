import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Globe, Lock } from "@/components/icons";
import { LoadingButtonLabel } from "@/components/cm/feedback";
import { Field, IconInput, SelectableCard } from "@/components/cm/forms";
import { friendlyError } from "@/lib/api/errors";
import { useSpaceCategories } from "@/lib/api/spaces";
import { useUpdateSpace } from "@/lib/api/spaces-manage";
import { type Space } from "@/lib/spaces-model";
import { cn } from "@/lib/utils";

/** Réglages d'une communauté ou d'un groupe, réservés au propriétaire et aux administrateurs. */
export function SpaceSettingsDialog({ space, open, onOpenChange }: { space: Space; open: boolean; onOpenChange: (o: boolean) => void }) {
  const categories = useSpaceCategories().data ?? [];
  const update = useUpdateSpace(space.id);
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description);
  const [category, setCategory] = useState(space.categorySlug);
  const [privacy, setPrivacy] = useState<"publique" | "privee">(space.privacy === "privee" ? "privee" : "publique");
  const [rules, setRules] = useState(space.rules.join("\n"));
  const [touched, setTouched] = useState(false);
  const [seen, setSeen] = useState(open);
  if (open !== seen) {
    setSeen(open);
    if (open) { setName(space.name); setDescription(space.description); setCategory(space.categorySlug); setPrivacy(space.privacy === "privee" ? "privee" : "publique"); setRules(space.rules.join("\n")); setTouched(false); }
  }

  const errors = {
    name: name.trim().length < 3 ? "Donnez un nom d'au moins 3 caractères." : undefined,
    description: description.trim().length < 10 ? "Décrivez en quelques mots de quoi il s'agit (10 caractères minimum)." : undefined,
  };
  const submit = () => {
    setTouched(true);
    if (errors.name || errors.description) return;
    update.mutate({ name, description, categorySlug: category, privacy, rules: rules.split("\n") }, {
      onSuccess: () => { toast.success("Réglages enregistrés"); onOpenChange(false); },
      onError: (e) => toast.error("Enregistrement impossible", { description: friendlyError(e) }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!update.isPending) onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">Réglages</DialogTitle><DialogDescription>Nom, description, catégorie, confidentialité et règles. Les membres actuels restent membres.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Field label="Nom" htmlFor="st-name" error={touched ? errors.name : undefined}><IconInput id="st-name" maxLength={120} value={name} invalid={touched && !!errors.name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Description" htmlFor="st-desc" error={touched ? errors.description : undefined} hint={`${description.length} / 2000`}><Textarea id="st-desc" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="Catégorie" htmlFor="st-cat">
            <div id="st-cat" className="flex flex-wrap gap-2" role="radiogroup" aria-label="Catégorie">
              {categories.map((c) => <button key={c.slug} type="button" role="radio" aria-checked={category === c.slug} onClick={() => setCategory(c.slug)} className={cn("rounded-full border px-3.5 py-1.5 text-sm font-semibold transition", category === c.slug ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{c.name}</button>)}
            </div>
          </Field>
          <div className="space-y-2" role="radiogroup" aria-label="Confidentialité">
            <SelectableCard selected={privacy === "publique"} onSelect={() => setPrivacy("publique")} icon={Globe} title="Publique" description="Tout le monde peut rejoindre immédiatement" />
            <SelectableCard selected={privacy === "privee"} onSelect={() => setPrivacy("privee")} icon={Lock} title="Privée" description="Les demandes sont validées par un administrateur" />
          </div>
          <Field label="Règles (une par ligne, 8 au maximum)" htmlFor="st-rules"><Textarea id="st-rules" value={rules} onChange={(e) => setRules(e.target.value)} /></Field>
          <Button size="lg" className="w-full" disabled={update.isPending} onClick={submit}><LoadingButtonLabel loading={update.isPending} loadingText="Enregistrement…">Enregistrer</LoadingButtonLabel></Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
