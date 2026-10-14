import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, IconInput } from "@/components/cm/forms";
import { Plus, Tag, Users, X } from "@/components/icons";
import { useGroupBuyActions } from "@/lib/api/groupbuys";
import { formatFcfa } from "@/lib/domain";

const DURATIONS = [{ label: "24 heures", hours: 24 }, { label: "3 jours", hours: 72 }, { label: "7 jours", hours: 168 }, { label: "14 jours", hours: 336 }, { label: "30 jours", hours: 720 }];
type TierInput = { qty: string; price: string };

/** Création d'un achat groupé par le vendeur : objectif, échéance et 1 à 5 paliers. Les règles (stock, prix décroissants, durée)
 *  sont revérifiées par la base ; ce formulaire n'en reprend que l'essentiel pour guider la saisie. */
export function CreateGroupBuyDialog({ open, onOpenChange, product, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; product: { id: string; name: string; price: number; quantity: number }; onCreated: () => void }) {
  const { create, errorText } = useGroupBuyActions();
  const [target, setTarget] = useState("");
  const [hours, setHours] = useState("168");
  const [tiers, setTiers] = useState<TierInput[]>([{ qty: "", price: "" }]);
  const [error, setError] = useState<string | null>(null);

  const setTier = (i: number, patch: Partial<TierInput>) => setTiers((t) => t.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const submit = () => {
    const goal = Number(target);
    const parsed = tiers.map((t) => ({ minParticipants: Number(t.qty), unitPrice: Number(t.price) }));
    if (!Number.isInteger(goal) || goal < 2) { setError("L'objectif doit être d'au moins 2 participants."); return; }
    if (goal > product.quantity) { setError(`Votre stock (${product.quantity} unité${product.quantity > 1 ? "s" : ""}) ne couvre pas cet objectif.`); return; }
    if (parsed.some((t) => !Number.isInteger(t.minParticipants) || !Number.isInteger(t.unitPrice) || t.minParticipants < 2 || t.minParticipants > goal || t.unitPrice < 0)) { setError("Chaque palier a besoin d'un nombre de participants (de 2 à l'objectif) et d'un prix."); return; }
    setError(null);
    const endsAt = new Date(Date.now() + Number(hours) * 3600_000).toISOString();
    create.mutate({ productId: product.id, target: goal, endsAt, tiers: parsed }, {
      onSuccess: () => { toast.success("Achat groupé créé"); onOpenChange(false); onCreated(); },
      onError: (e) => setError(errorText(e, "Création impossible. Vérifiez les informations et réessayez.")),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">Créer un achat groupé</DialogTitle><DialogDescription>{product.name} · prix actuel {formatFcfa(product.price)}</DialogDescription></DialogHeader>
        <Field label="Objectif de participants" htmlFor="gb-target" hint={`Maximum ${product.quantity} (votre stock).`}><IconInput id="gb-target" icon={Users} inputMode="numeric" placeholder="Ex. 10" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label="Durée" htmlFor="gb-duree">
          <Select value={hours} onValueChange={setHours}><SelectTrigger id="gb-duree" className="h-11 bg-card"><SelectValue /></SelectTrigger><SelectContent>{DURATIONS.map((d) => <SelectItem key={d.hours} value={String(d.hours)}>{d.label}</SelectItem>)}</SelectContent></Select>
        </Field>
        <div className="space-y-2">
          <p className="text-[13px] font-semibold">Paliers de prix</p>
          <p className="text-xs text-muted-foreground">Plus il y a de participants, plus le prix baisse. Le prix final, identique pour tous, est celui du palier atteint à l'objectif.</p>
          {tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <IconInput aria-label={`Participants du palier ${i + 1}`} icon={Users} inputMode="numeric" placeholder="Participants" value={t.qty} onChange={(e) => setTier(i, { qty: e.target.value.replace(/\D/g, "") })} />
              <IconInput aria-label={`Prix du palier ${i + 1}`} icon={Tag} inputMode="numeric" placeholder="Prix (F)" value={t.price} onChange={(e) => setTier(i, { price: e.target.value.replace(/\D/g, "") })} />
              {tiers.length > 1 && <button type="button" aria-label={`Retirer le palier ${i + 1}`} onClick={() => setTiers((x) => x.filter((_, j) => j !== i))} className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button>}
            </div>
          ))}
          {tiers.length < 5 && <button type="button" onClick={() => setTiers((x) => [...x, { qty: "", price: "" }])} className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"><Plus className="size-4" /> Ajouter un palier</button>}
        </div>
        <p className="text-xs text-muted-foreground">Les participants s'engagent sans payer. Une fois l'objectif atteint, ils ont 48 h pour payer au prix final ; les conditions ne changent plus dès que quelqu'un a rejoint.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button size="lg" className="w-full" onClick={submit} disabled={create.isPending}>{create.isPending ? "Création…" : "Créer l'achat groupé"}</Button>
      </DialogContent>
    </Dialog>
  );
}
