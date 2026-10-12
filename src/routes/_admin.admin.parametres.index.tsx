import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, IconInput } from "@/components/cm/forms";
import { ConfirmDialog } from "@/components/cm/feedback";
import { PageHeader } from "@/components/layout/PageHeader";
import { History, Mail, Plus, Shield, ShieldCheck, Sliders, Trash, Users } from "@/components/icons";
import { Avatar } from "@/components/cm/commerce";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_admin/admin/parametres/")({
  head: () => ({ meta: [{ title: "Paramètres — Administration CampusMarket" }] }),
  component: AdminSettingsPage,
});

type Role = "Super administrateur" | "Modérateur" | "Support";
type Member = { id: string; name: string; email: string; role: Role };
const roles: Role[] = ["Super administrateur", "Modérateur", "Support"];
const seedTeam: Member[] = [
  { id: "m1", name: "Cabrel Fotso", email: "cabrel@campusmarket.africa", role: "Super administrateur" },
  { id: "m2", name: "Aline Support", email: "aline@campusmarket.africa", role: "Support" },
  { id: "m3", name: "Bruno Support", email: "bruno@campusmarket.africa", role: "Modérateur" },
];

type AuditEntry = { id: string; who: string; action: string; time: string };
const auditLog: AuditEntry[] = [
  { id: "a1", who: "Cabrel Fotso", action: "A banni le compte de Ruth Nkeng", time: "Il y a 2 heures" },
  { id: "a2", who: "Bruno Support", action: "A retiré l'annonce « Cours particuliers — tous niveaux »", time: "Il y a 4 heures" },
  { id: "a3", who: "Aline Support", action: "A ajouté l'université Université de Douala à l'annuaire", time: "Hier" },
  { id: "a4", who: "Cabrel Fotso", action: "A activé la double authentification pour son compte", time: "Il y a 3 jours" },
  { id: "a5", who: "Bruno Support", action: "A suspendu le compte de Paul Ndzana", time: "Il y a 5 jours" },
];

type Tab = "equipe" | "audit" | "securite";

function AdminSettingsPage() {
  const [tab, setTab] = useState<Tab>("equipe");
  const [team, setTeam] = useState<Member[]>(seedTeam);
  const [twoFa, setTwoFa] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("Support");
  const [toRemove, setToRemove] = useState<Member | null>(null);

  const invite = () => {
    if (!inviteEmail.trim().includes("@")) return;
    setTeam((cur) => [...cur, { id: `m-${Date.now()}`, name: inviteEmail.split("@")[0] ?? "Nouveau membre", email: inviteEmail.trim(), role: inviteRole }]);
    toast.success(`Invitation envoyée à ${inviteEmail}`);
    setInviteEmail(""); setInviteOpen(false);
  };

  return (
    <div>
      <PageHeader kicker="Administration" title="Paramètres" description="Gérez l'équipe, les rôles et la sécurité de l'espace admin." breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Paramètres" }]} />

      <div role="tablist" className="mb-6 inline-flex rounded-lg border border-border bg-secondary p-1">
        <button role="tab" aria-selected={tab === "equipe"} onClick={() => setTab("equipe")} className={cn("flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold", tab === "equipe" ? "bg-card shadow-soft" : "text-muted-foreground")}><Users className="size-4" /> Équipe &amp; rôles</button>
        <button role="tab" aria-selected={tab === "audit"} onClick={() => setTab("audit")} className={cn("flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold", tab === "audit" ? "bg-card shadow-soft" : "text-muted-foreground")}><History className="size-4" /> Journal d'audit</button>
        <button role="tab" aria-selected={tab === "securite"} onClick={() => setTab("securite")} className={cn("flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold", tab === "securite" ? "bg-card shadow-soft" : "text-muted-foreground")}><Shield className="size-4" /> Sécurité</button>
      </div>

      {tab === "equipe" && (
        <div>
          <div className="mb-3 flex justify-end"><Button onClick={() => setInviteOpen(true)}><Plus /> Inviter un membre</Button></div>
          <div className="space-y-2">
            {team.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3.5">
                <Avatar name={m.name} size="md" />
                <div className="min-w-0 flex-1 basis-40"><p className="font-semibold">{m.name}</p><p className="truncate text-xs text-muted-foreground">{m.email}</p></div>
                <Select value={m.role} onValueChange={(v) => setTeam((cur) => cur.map((x) => (x.id === m.id ? { ...x, role: v as Role } : x)))}>
                  <SelectTrigger className="h-9 w-full bg-background text-sm sm:w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>{roles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
                {m.role !== "Super administrateur" && <Button variant="ghost" size="icon" aria-label={`Retirer ${m.name}`} onClick={() => setToRemove(m)}><Trash className="size-5 text-destructive" /></Button>}
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            <p className="mb-2 flex items-center gap-2 font-semibold text-foreground"><Sliders className="size-4 text-primary" /> Permissions par rôle</p>
            <ul className="space-y-1">
              <li><strong className="text-foreground">Super administrateur</strong> — accès complet, gestion de l'équipe et des paramètres.</li>
              <li><strong className="text-foreground">Modérateur</strong> — annonces, utilisateurs, universités, géographie.</li>
              <li><strong className="text-foreground">Support</strong> — tickets et signalements uniquement.</li>
            </ul>
          </div>
        </div>
      )}

      {tab === "audit" && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {auditLog.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-4 py-3.5">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><History className="size-4" /></span>
              <div className="min-w-0 flex-1"><p className="text-sm"><span className="font-semibold">{a.who}</span> {a.action}</p><p className="mt-0.5 text-xs text-muted-foreground">{a.time}</p></div>
            </li>
          ))}
        </ul>
      )}

      {tab === "securite" && (
        <div className="max-w-lg space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-3"><ShieldCheck className="size-6 text-primary" /><div><p className="font-semibold">Double authentification (2FA)</p><p className="text-xs text-muted-foreground">Exiger un code de vérification pour tous les comptes administrateurs.</p></div></div>
            <Switch checked={twoFa} onCheckedChange={(v) => { setTwoFa(v); toast.success(v ? "2FA activée pour l'équipe" : "2FA désactivée pour l'équipe"); }} />
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-1 font-semibold">Sessions actives</p>
            <p className="text-sm text-muted-foreground">3 sessions actives sur l'espace admin. En cas de doute, révoquez tous les accès et redemandez une connexion.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => toast.success("Toutes les sessions ont été révoquées (démo)")}>Révoquer toutes les sessions</Button>
          </div>
        </div>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display">Inviter un membre</DialogTitle><DialogDescription>Un email d'invitation lui sera envoyé.</DialogDescription></DialogHeader>
          <Field label="Adresse email" htmlFor="inv-email"><IconInput id="inv-email" icon={Mail} type="email" placeholder="prenom@campusmarket.africa" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} /></Field>
          <Field label="Rôle" htmlFor="inv-role"><Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}><SelectTrigger id="inv-role" className="h-11 bg-card"><SelectValue /></SelectTrigger><SelectContent>{roles.filter((r) => r !== "Super administrateur").map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></Field>
          <DialogFooter><Button variant="outline" onClick={() => setInviteOpen(false)}>Annuler</Button><Button onClick={invite}>Envoyer l'invitation</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!toRemove} onOpenChange={(o) => !o && setToRemove(null)} title={`Retirer ${toRemove?.name} de l'équipe ?`} description="Cette personne perdra immédiatement l'accès à l'espace administrateur." confirmLabel="Retirer" destructive
        onConfirm={() => { if (toRemove) { setTeam((cur) => cur.filter((m) => m.id !== toRemove.id)); toast.success("Membre retiré"); } setToRemove(null); }} />
    </div>
  );
}
