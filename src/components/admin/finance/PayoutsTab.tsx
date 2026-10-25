import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/cm/forms";
import { InlineAlert } from "@/components/cm/feedback";
import { EmptyScreen, ServerErrorScreen } from "@/components/cm/screens";
import { Switch } from "@/components/ui/switch";
import { formatFcfa } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { PAYOUTS_PAGE, useCreatorBalances, useFinanceActions, usePayouts, type CreatorBalance, type Payout } from "@/lib/api/admin-finance";
import { Stat, parseInteger, providerLabel, skeleton, timeFmt } from "./shared";

function PayoutDialog({ creator, onClose }: { creator: CreatorBalance | null; onClose: () => void }) {
  const acts = useFinanceActions();
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const open = creator !== null;
  const submit = async () => {
    if (!creator) return;
    const a = parseInteger(amount || String(creator.available));
    if (a === null || a <= 0) return setError("Saisissez un montant valide.");
    if (a > creator.available) return setError(`Le montant dépasse le solde disponible (${formatFcfa(creator.available)}).`);
    setError(null);
    try {
      await acts.recordPayout.mutateAsync({ creatorId: creator.creatorId, amount: a, reference, note });
      toast.success("Versement enregistré. La personne est notifiée.");
      setAmount(""); setReference(""); setNote("");
      onClose();
    } catch (e) { setError(acts.errorText(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setError(null); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Enregistrer un versement</DialogTitle>
          <DialogDescription>CampusMarket n'envoie pas l'argent : faites d'abord le transfert Mobile Money, puis enregistrez-le ici pour mettre le solde à jour.</DialogDescription>
        </DialogHeader>
        {creator && (
          <div className="space-y-3">
            <div className="rounded-lg bg-secondary p-3 text-sm">
              <p className="font-semibold">{creator.name}</p>
              <p className="text-muted-foreground">{providerLabel(creator.provider)} · {creator.phone}</p>
              <p className="text-muted-foreground">Titulaire : {creator.holderName}</p>
              <p className="mt-1">Solde disponible : <strong>{formatFcfa(creator.available)}</strong></p>
            </div>
            <Field label="Montant versé (FCFA)" htmlFor="po-amount"><Input id="po-amount" inputMode="numeric" placeholder={String(creator.available)} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Référence de la transaction (facultatif)" htmlFor="po-ref"><Input id="po-ref" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
            <Field label="Note interne (facultatif)" htmlFor="po-note"><Textarea id="po-note" maxLength={500} rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Annuler</Button><Button onClick={() => void submit()} disabled={acts.recordPayout.isPending}>{acts.recordPayout.isPending ? "Enregistrement…" : "Enregistrer le versement"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ payout, onClose }: { payout: Payout | null; onClose: () => void }) {
  const acts = useFinanceActions();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!payout) return;
    if (reason.trim().length < 3) return setError("Indiquez un motif (3 caractères minimum).");
    setError(null);
    try {
      await acts.voidPayout.mutateAsync({ id: payout.id, reason: reason.trim() });
      toast.success("Versement annulé : le montant redevient disponible.");
      setReason(""); onClose();
    } catch (e) { setError(acts.errorText(e)); }
  };
  return (
    <Dialog open={payout !== null} onOpenChange={(o) => { if (!o) { setError(null); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display">Annuler ce versement ?</DialogTitle>
          <DialogDescription>{payout ? `${formatFcfa(payout.amount)} pour ${payout.creatorName}. À utiliser seulement si le transfert n'a pas réellement eu lieu (erreur de saisie, numéro erroné).` : ""}</DialogDescription>
        </DialogHeader>
        <Field label="Motif" htmlFor="void-reason"><Textarea id="void-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Retour</Button><Button variant="destructive" onClick={() => void submit()} disabled={acts.voidPayout.isPending}>Annuler le versement</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PayoutsTab({ canEdit }: { canEdit: boolean }) {
  const [onlyDue, setOnlyDue] = useState(true);
  const [offset, setOffset] = useState(0);
  const balances = useCreatorBalances(onlyDue);
  const payouts = usePayouts(offset);
  const [target, setTarget] = useState<CreatorBalance | null>(null);
  const [toVoid, setToVoid] = useState<Payout | null>(null);

  if (balances.isPending) return skeleton;
  if (balances.isError || !balances.data) return <ServerErrorScreen compact onRetry={() => void balances.refetch()} />;
  const { totals, creators } = balances.data;
  const history = payouts.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="À verser maintenant" value={formatFcfa(totals.available)} hint={`${totals.creatorsDue} personne(s) concernée(s)`} tone={totals.available > 0 ? "good" : "default"} />
        <Stat label="Gains pas encore disponibles" value={formatFcfa(totals.pending)} hint="Commande non clôturée, événement ou séance à venir, délai en cours." />
        <Stat label="Déjà versé" value={formatFcfa(totals.paid)} hint="Versements enregistrés, hors versements annulés." />
      </div>
      {!canEdit && <InlineAlert tone="info">Consultation : l'enregistrement et l'annulation d'un versement sont réservés aux administrateurs et au responsable financier.</InlineAlert>}

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-bold">Soldes des créateurs</h2>
          <label className="flex items-center gap-2 text-sm"><Switch checked={onlyDue} onCheckedChange={setOnlyDue} aria-label="Afficher seulement les soldes à verser" /> Seulement les soldes à verser</label>
        </div>
        {creators.length === 0 ? (
          <div className="mt-4"><EmptyScreen compact title={onlyDue ? "Rien à verser" : "Aucun gain enregistré"} description="Les gains des vendeurs, formateurs, organisateurs et tuteurs apparaissent ici dès qu'ils sont disponibles." /></div>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {creators.map((c) => (
              <li key={c.creatorId} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1 basis-52">
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.hasAccount ? `${providerLabel(c.provider)} · ${c.phone}` : "Aucun compte de versement enregistré"}</p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-bold tabular-nums">{formatFcfa(c.available)}</p>
                  <p className="text-xs text-muted-foreground">+ {formatFcfa(c.pending)} en attente · {formatFcfa(c.paid)} versés</p>
                </div>
                {canEdit && <Button size="sm" disabled={!c.hasAccount || c.available <= 0} onClick={() => setTarget(c)} title={c.hasAccount ? undefined : "La personne doit d'abord enregistrer son compte de versement."}>Verser</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-bold">Historique des versements</h2>
        {payouts.isPending ? <div className="mt-3">{skeleton}</div> : payouts.isError ? <ServerErrorScreen compact onRetry={() => void payouts.refetch()} /> : (history?.payouts.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Aucun versement enregistré.</p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-border">
              {history!.payouts.map((p) => (
                <li key={p.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm", p.voidedAt && "opacity-60")}>
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="font-medium">{p.creatorName}{p.voidedAt && <span className="ml-2 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-semibold">Annulé</span>}</p>
                    <p className="text-xs text-muted-foreground">{timeFmt(p.createdAt)} · {providerLabel(p.provider)}{p.reference ? ` · réf. ${p.reference}` : ""}</p>
                    {p.voidReason && <p className="text-xs text-muted-foreground">Motif d'annulation : {p.voidReason}</p>}
                  </div>
                  <p className={cn("font-semibold tabular-nums", p.voidedAt && "line-through")}>{formatFcfa(p.amount)}</p>
                  {canEdit && !p.voidedAt && <Button variant="ghost" size="sm" onClick={() => setToVoid(p)}>Annuler</Button>}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>{offset + 1}–{Math.min(offset + PAYOUTS_PAGE, history!.total)} sur {history!.total}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAYOUTS_PAGE))}>Précédent</Button>
                <Button variant="outline" size="sm" disabled={offset + PAYOUTS_PAGE >= history!.total} onClick={() => setOffset(offset + PAYOUTS_PAGE)}>Suivant</Button>
              </div>
            </div>
          </>
        )}
      </section>

      <PayoutDialog creator={target} onClose={() => setTarget(null)} />
      <VoidDialog payout={toVoid} onClose={() => setToVoid(null)} />
    </div>
  );
}
