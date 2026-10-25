import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, SearchField } from "@/components/cm/forms";
import { ConfirmDialog, InlineAlert } from "@/components/cm/feedback";
import { ServerErrorScreen } from "@/components/cm/screens";
import { Plus } from "@/components/icons";
import { formatFcfa } from "@/lib/domain";
import {
  FEE_INFO, FEE_KINDS, FLAG_INFO, useFeeSettings, useFinanceActions, useRegistrationFees, useSellerPlans,
  type FeeSetting, type FlagKey, type RegistrationCountry, type SellerPlan,
} from "@/lib/api/admin-finance";
import { dayFmt, parseInteger, parsePercent, skeleton } from "./shared";

const COMMISSION_KINDS = new Set(["order_seller_commission", "course_commission", "event_commission", "tutoring_commission"]);

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-display text-base font-bold">{title}</h2>
      {description && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/* ------------------------------ Interrupteurs ------------------------------ */

const FLAG_CONFIRM: Record<FlagKey, { on: string; off: string }> = {
  paid_tutoring: {
    on: "Les tuteurs pourront fixer un prix horaire et les élèves paieront après l'acceptation de la séance.",
    off: "Les nouvelles demandes de tutorat redeviennent gratuites. Les séances déjà acceptées et payantes suivent leur cours.",
  },
  paid_registration: {
    on: "Les nouveaux comptes des pays qui ont un tarif actif devront payer avant d'accéder à la plateforme. Les comptes existants ne sont pas concernés.",
    off: "Les comptes qui attendent de payer sont libérés immédiatement et l'inscription redevient gratuite.",
  },
};

function FlagsSection({ flags, canEdit }: { flags: Record<FlagKey, boolean>; canEdit: boolean }) {
  const acts = useFinanceActions();
  const [pending, setPending] = useState<{ key: FlagKey; enabled: boolean } | null>(null);
  const confirm = async () => {
    if (!pending) return;
    try {
      await acts.setFlag.mutateAsync(pending);
      toast.success(pending.enabled ? "Option activée." : "Option désactivée.");
    } catch (e) { toast.error(acts.errorText(e)); }
    setPending(null);
  };
  return (
    <Section title="Fonctionnalités payantes" description="Interrupteurs généraux, désactivés par défaut.">
      <ul className="divide-y divide-border">
        {(Object.keys(FLAG_INFO) as FlagKey[]).map((key) => (
          <li key={key} className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1"><p className="font-semibold">{FLAG_INFO[key].label}</p><p className="text-xs leading-5 text-muted-foreground">{FLAG_INFO[key].hint}</p></div>
            <Switch checked={flags[key]} disabled={!canEdit || acts.setFlag.isPending} aria-label={FLAG_INFO[key].label} onCheckedChange={(v) => setPending({ key, enabled: v })} />
          </li>
        ))}
      </ul>
      <ConfirmDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)} destructive={!!pending && !pending.enabled}
        title={pending ? `${pending.enabled ? "Activer" : "Désactiver"} « ${FLAG_INFO[pending.key].label} » ?` : ""}
        description={pending ? FLAG_CONFIRM[pending.key][pending.enabled ? "on" : "off"] : ""} confirmLabel={pending?.enabled ? "Activer" : "Désactiver"} onConfirm={confirm} />
    </Section>
  );
}

/* ------------------------------ Frais et commissions ------------------------------ */

function FeeRow({ setting, canEdit }: { setting: FeeSetting; canEdit: boolean }) {
  const acts = useFinanceActions();
  const info = FEE_INFO[setting.kind];
  const hasHold = COMMISSION_KINDS.has(setting.kind);
  const [percent, setPercent] = useState(String(setting.percent));
  const [fixed, setFixed] = useState(String(setting.fixed));
  const [hold, setHold] = useState(String(setting.holdDays));
  const [error, setError] = useState<string | null>(null);
  const dirty = percent !== String(setting.percent) || fixed !== String(setting.fixed) || hold !== String(setting.holdDays);

  const save = async () => {
    const p = info.fixedOnly ? 0 : parsePercent(percent);
    const f = parseInteger(fixed);
    const h = hasHold ? parseInteger(hold) : 0;
    if (p === null || p > 30) return setError("Pourcentage : de 0 à 30 % (deux décimales au plus).");
    if (f === null || f > 50000) return setError("Montant fixe : de 0 à 50 000 FCFA.");
    if (h === null || h > 60) return setError("Délai : de 0 à 60 jours.");
    setError(null);
    try {
      await acts.saveFee.mutateAsync({ kind: setting.kind, percent: p, fixed: f, holdDays: h });
      toast.success("Réglage enregistré. Il s'applique aux prochains paiements.");
    } catch (e) { setError(acts.errorText(e)); }
  };

  return (
    <li className="rounded-xl border border-border p-4">
      <p className="font-semibold">{info.label}</p>
      <p className="text-xs leading-5 text-muted-foreground">{info.hint}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Pourcentage (%)" htmlFor={`pct-${setting.kind}`}>
          <Input id={`pct-${setting.kind}`} inputMode="decimal" value={info.fixedOnly ? "0" : percent} onChange={(e) => setPercent(e.target.value)} disabled={!canEdit || info.fixedOnly} />
        </Field>
        <Field label="Montant fixe (FCFA)" htmlFor={`fix-${setting.kind}`}>
          <Input id={`fix-${setting.kind}`} inputMode="numeric" value={fixed} onChange={(e) => setFixed(e.target.value)} disabled={!canEdit} />
        </Field>
        {hasHold && (
          <Field label="Délai avant versement (jours)" htmlFor={`hold-${setting.kind}`} hint="Ajouté après la clôture de la commande, l'inscription, la fin de l'événement ou de la séance.">
            <Input id={`hold-${setting.kind}`} inputMode="numeric" value={hold} onChange={(e) => setHold(e.target.value)} disabled={!canEdit} />
          </Field>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Modifié le {dayFmt(setting.updatedAt)}{setting.updatedBy ? ` par ${setting.updatedBy}` : ""}</p>
        {canEdit && <Button size="sm" onClick={() => void save()} disabled={!dirty || acts.saveFee.isPending}>{acts.saveFee.isPending ? "Enregistrement…" : "Enregistrer"}</Button>}
      </div>
    </li>
  );
}

/* ------------------------------ Inscription : tarifs par pays ------------------------------ */

function CountryRow({ country, canEdit }: { country: RegistrationCountry; canEdit: boolean }) {
  const acts = useFinanceActions();
  const [price, setPrice] = useState(country.price === null ? "" : String(country.price));
  const [active, setActive] = useState(country.active);
  const [error, setError] = useState<string | null>(null);
  const dirty = price !== (country.price === null ? "" : String(country.price)) || active !== country.active;

  const save = async () => {
    const p = parseInteger(price);
    if (p === null || p < 500 || p > 100000) return setError("Tarif : de 500 à 100 000 FCFA.");
    setError(null);
    try {
      await acts.saveRegistrationFee.mutateAsync({ country: country.code, price: p, active });
      toast.success(`Tarif enregistré pour ${country.name}.`);
    } catch (e) { setError(acts.errorText(e)); }
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 basis-40 font-medium">{country.name} <span className="text-xs text-muted-foreground">({country.code})</span></p>
        <Input aria-label={`Tarif d'inscription pour ${country.name}`} placeholder="FCFA" inputMode="numeric" className="h-9 w-28" value={price} onChange={(e) => setPrice(e.target.value)} disabled={!canEdit} />
        <label className="flex items-center gap-2 text-sm"><Switch checked={active} onCheckedChange={setActive} disabled={!canEdit} aria-label={`Tarif actif pour ${country.name}`} /> Actif</label>
        {canEdit && <Button size="sm" onClick={() => void save()} disabled={!dirty || acts.saveRegistrationFee.isPending}>Enregistrer</Button>}
      </div>
      {error && <p role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
    </li>
  );
}

function RegistrationSection({ canEdit }: { canEdit: boolean }) {
  const query = useRegistrationFees();
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...(query.data ?? [])]
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q)
      .sort((a, b) => Number(b.price !== null) - Number(a.price !== null) || a.name.localeCompare(b.name, "fr"));
  }, [query.data, search]);
  return (
    <Section title="Tarifs d'inscription par pays" description="Le pays d'un compte est déduit de son numéro de téléphone vérifié. Un pays sans tarif actif reste gratuit. Les paiements se font en FCFA par Mobile Money camerounais (+237) pour l'instant.">
      {query.isPending ? skeleton : query.isError ? <ServerErrorScreen compact onRetry={() => void query.refetch()} /> : (
        <>
          <SearchField placeholder="Rechercher un pays" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher un pays" />
          <ul className="mt-2 max-h-[28rem] divide-y divide-border overflow-y-auto pr-1">
            {rows.map((c) => <CountryRow key={`${c.code}-${c.price}-${c.active}`} country={c} canEdit={canEdit} />)}
            {rows.length === 0 && <li className="py-4 text-sm text-muted-foreground">Aucun pays ne correspond.</li>}
          </ul>
        </>
      )}
    </Section>
  );
}

/* ------------------------------ Formules Boutique Premium ------------------------------ */

function PlanRow({ plan, onDone }: { plan: SellerPlan | null; onDone?: (() => void) | undefined }) {
  const acts = useFinanceActions();
  const [label, setLabel] = useState(plan?.label ?? "");
  const [days, setDays] = useState(plan ? String(plan.days) : "30");
  const [price, setPrice] = useState(plan ? String(plan.price) : "");
  const [active, setActive] = useState(plan?.active ?? false);
  const [error, setError] = useState<string | null>(null);
  const dirty = !plan || label !== plan.label || days !== String(plan.days) || price !== String(plan.price) || active !== plan.active;

  const save = async () => {
    const d = parseInteger(days);
    const p = parseInteger(price);
    if (label.trim().length < 2 || label.trim().length > 40) return setError("Nom : 2 à 40 caractères.");
    if (d === null || d < 7 || d > 366) return setError("Durée : de 7 à 366 jours.");
    if (p === null || p < 500 || p > 500000) return setError("Prix : de 500 à 500 000 FCFA.");
    setError(null);
    try {
      await acts.savePlan.mutateAsync({ id: plan?.id ?? null, label: label.trim(), days: d, price: p, active, sortOrder: plan?.sortOrder ?? 99 });
      toast.success(plan ? "Formule enregistrée." : "Formule créée.");
      onDone?.();
    } catch (e) { setError(acts.errorText(e)); }
  };

  return (
    <li className="rounded-xl border border-border p-4">
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
        <Field label="Nom" htmlFor={`pl-label-${plan?.id ?? "new"}`}><Input id={`pl-label-${plan?.id ?? "new"}`} value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <Field label="Durée (jours)" htmlFor={`pl-days-${plan?.id ?? "new"}`}><Input id={`pl-days-${plan?.id ?? "new"}`} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <Field label="Prix (FCFA)" htmlFor={`pl-price-${plan?.id ?? "new"}`}><Input id={`pl-price-${plan?.id ?? "new"}`} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <label className="flex items-end gap-2 pb-2.5 text-sm"><Switch checked={active} onCheckedChange={setActive} aria-label="Formule active" /> Active</label>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        {!plan && <Button variant="outline" size="sm" onClick={onDone}>Annuler</Button>}
        <Button size="sm" onClick={() => void save()} disabled={!dirty || acts.savePlan.isPending}>{acts.savePlan.isPending ? "Enregistrement…" : plan ? "Enregistrer" : "Créer la formule"}</Button>
      </div>
    </li>
  );
}

function PlansSection({ canEdit }: { canEdit: boolean }) {
  const query = useSellerPlans();
  const [adding, setAdding] = useState(false);
  return (
    <Section title="Formules Boutique Premium" description="Abonnement des vendeurs : badge Premium et aucune commission sur leurs ventes. Une formule inactive n'est pas proposée aux vendeurs.">
      {query.isPending ? skeleton : query.isError ? <ServerErrorScreen compact onRetry={() => void query.refetch()} /> : !canEdit ? (
        <ul className="space-y-1.5 text-sm">{(query.data ?? []).map((p) => <li key={p.id} className="flex justify-between rounded-lg bg-secondary px-3 py-2"><span>{p.label} · {p.days} j</span><span className="font-semibold">{formatFcfa(p.price)} {p.active ? "" : "(inactive)"}</span></li>)}</ul>
      ) : (
        <>
          <ul className="space-y-3">
            {(query.data ?? []).map((p) => <PlanRow key={`${p.id}-${p.label}-${p.days}-${p.price}-${p.active}`} plan={p} />)}
            {adding && <PlanRow plan={null} onDone={() => setAdding(false)} />}
          </ul>
          {!adding && <Button variant="outline" size="sm" className="mt-3" onClick={() => setAdding(true)}><Plus /> Ajouter une formule</Button>}
        </>
      )}
    </Section>
  );
}

/* ------------------------------ Onglet ------------------------------ */

export function SettingsTab({ canEdit }: { canEdit: boolean }) {
  const query = useFeeSettings();
  if (query.isPending) return skeleton;
  if (query.isError || !query.data) return <ServerErrorScreen compact onRetry={() => void query.refetch()} />;
  const byKind = new Map(query.data.settings.map((s) => [s.kind, s]));
  return (
    <div className="space-y-6">
      {!canEdit && <InlineAlert tone="info">Consultation seule : seuls les administrateurs peuvent modifier ces réglages.</InlineAlert>}
      <FlagsSection flags={query.data.flags} canEdit={canEdit} />
      <Section title="Frais et commissions" description="Un réglage ne s'applique qu'aux paiements à venir : l'historique garde le taux d'origine. Commission = pourcentage du prix + montant fixe, sans jamais dépasser le prix.">
        <ul className="space-y-3">
          {FEE_KINDS.map((k) => { const s = byKind.get(k); return s ? <FeeRow key={`${k}-${s.updatedAt}`} setting={s} canEdit={canEdit} /> : null; })}
        </ul>
      </Section>
      <RegistrationSection canEdit={canEdit} />
      <PlansSection canEdit={canEdit} />
    </div>
  );
}
