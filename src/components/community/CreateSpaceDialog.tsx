import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Globe, Lock } from "@/components/icons";
import { LoadingButtonLabel } from "@/components/cm/feedback";
import { Field, IconInput, SelectableCard } from "@/components/cm/forms";
import { friendlyError } from "@/lib/api/errors";
import { useSpaceActions, useSpaceCategories } from "@/lib/api/spaces";
import { useAuth } from "@/lib/auth";
import { kindLabels, type SpaceKind } from "@/lib/spaces-model";
import { cn } from "@/lib/utils";

/** Création d'une communauté ou d'un groupe : la personne en devient propriétaire (déclencheur de la base). */
export function CreateSpaceDialog({ kind, open, onOpenChange }: { kind: SpaceKind; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const actions = useSpaceActions(session?.user.id);
  const categories = useSpaceCategories().data ?? [];
  const label = kindLabels[kind];
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [privacy, setPrivacy] = useState<"publique" | "privee">("publique");
  const [rules, setRules] = useState("");
  const [touched, setTouched] = useState(false);

  const errors = {
    name: name.trim().length < 3 ? "Donnez un nom d'au moins 3 caractères." : undefined,
    description: description.trim().length < 10 ? "Décrivez en quelques mots de quoi il s'agit (10 caractères minimum)." : undefined,
    category: category ? undefined : "Choisissez une catégorie.",
  };
  const valid = !errors.name && !errors.description && !errors.category;

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    actions.create.mutate({ kind, name, description, categorySlug: category, privacy, rules: rules.split("\n").slice(0, 8) }, {
      onSuccess: (id) => { toast.success(`${label.article} ${label.one} vient d'être créé${kind === "communaute" ? "e" : ""}`); onOpenChange(false); void navigate({ to: `${label.basePath}/${id}` as "/" }); },
      onError: (e) => toast.error("Création impossible", { description: friendlyError(e) }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!actions.create.isPending) onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">Créer {label.article.toLowerCase()} {label.one}</DialogTitle><DialogDescription>Vous en serez le propriétaire et pourrez nommer des modérateurs.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Field label="Nom" htmlFor="sp-name" error={touched ? errors.name : undefined}><IconInput id="sp-name" maxLength={120} value={name} invalid={touched && !!errors.name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Description" htmlFor="sp-desc" error={touched ? errors.description : undefined} hint={`${description.length} / 2000`}><Textarea id="sp-desc" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="Catégorie" htmlFor="sp-cat" error={touched ? errors.category : undefined}>
            <div id="sp-cat" className="flex flex-wrap gap-2" role="radiogroup" aria-label="Catégorie">
              {categories.map((c) => <button key={c.slug} type="button" role="radio" aria-checked={category === c.slug} onClick={() => setCategory(c.slug)} className={cn("rounded-full border px-3.5 py-1.5 text-sm font-semibold transition", category === c.slug ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{c.name}</button>)}
            </div>
          </Field>
          <div className="space-y-2" role="radiogroup" aria-label="Confidentialité">
            <SelectableCard selected={privacy === "publique"} onSelect={() => setPrivacy("publique")} icon={Globe} title="Publique" description="Tout le monde peut rejoindre immédiatement" />
            <SelectableCard selected={privacy === "privee"} onSelect={() => setPrivacy("privee")} icon={Lock} title="Privée" description="Les demandes sont validées par un administrateur" />
          </div>
          <Field label="Règles (une par ligne, facultatif)" htmlFor="sp-rules"><Textarea id="sp-rules" value={rules} onChange={(e) => setRules(e.target.value)} placeholder={"Restez respectueux\nPas de publicité"} /></Field>
          <Button size="lg" className="w-full" disabled={actions.create.isPending} onClick={submit}><LoadingButtonLabel loading={actions.create.isPending} loadingText="Création…">Créer {label.the}</LoadingButtonLabel></Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
