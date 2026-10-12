import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar } from "@/components/cm/commerce";
import { Pill } from "@/components/cm/badges";
import { ConfirmDialog } from "@/components/cm/feedback";
import { EmptyScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { StateSwitcher } from "@/components/cm/state-switcher";
import { PageHeader } from "@/components/layout/PageHeader";
import { BadgeCheck, Block, Flag, MoreVertical, RefreshCw, Search, Shield, UserX, X } from "@/components/icons";
import { adminUsers as seedUsers, type AdminUser, type UserStatus } from "@/lib/mock-admin";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type AdminUsersSearch = { q?: string | undefined; statut?: UserStatus | undefined };

export const Route = createFileRoute("/_admin/admin/utilisateurs/")({
  validateSearch: (s: Record<string, unknown>): AdminUsersSearch => ({
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    statut: (["actif", "suspendu", "banni"] as const).find((v) => v === s["statut"]),
  }),
  head: () => ({ meta: [{ title: "Utilisateurs — Administration CampusMarket" }] }),
  component: AdminUsersPage,
});

type Preview = "liste" | "recherche" | "aucun" | "vide" | "chargement" | "erreur";
const previews = [
  { id: "liste", label: "Liste" },
  { id: "recherche", label: "Recherche" },
  { id: "aucun", label: "Aucun résultat" },
  { id: "vide", label: "Aucun utilisateur" },
  { id: "chargement", label: "Chargement" },
  { id: "erreur", label: "Erreur serveur" },
] as const satisfies readonly { id: Preview; label: string }[];

const statusTone: Record<UserStatus, "success" | "warning" | "danger"> = { actif: "success", suspendu: "warning", banni: "danger" };
const statusLabel: Record<UserStatus, string> = { actif: "Actif", suspendu: "Suspendu", banni: "Banni" };
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

type Confirm = { user: AdminUser; action: "suspendre" | "bannir" | "reactiver" } | null;

function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>(seedUsers);
  const [preview, setPreview] = useState<Preview>("liste");
  const [q, setQ] = useState("");
  const [statut, setStatut] = useState<UserStatus | undefined>(undefined);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const applyPreview = (id: Preview) => { setPreview(id); if (id === "recherche") setQ("ndzana"); if (id === "liste") { setQ(""); setStatut(undefined); } };

  const qn = normalize(q);
  const results = users.filter((u) => (!statut || u.status === statut) && (!qn || normalize(`${u.name} ${u.email} ${u.campus}`).includes(qn)));

  const verify = (u: AdminUser) => { setUsers((cur) => cur.map((x) => (x.id === u.id ? { ...x, verified: true } : x))); toast.success(`${u.name} est maintenant vérifié·e`); };
  const applyStatus = (u: AdminUser, status: UserStatus) => { setUsers((cur) => cur.map((x) => (x.id === u.id ? { ...x, status } : x))); };

  const runConfirm = () => {
    if (!confirm) return;
    const { user, action } = confirm;
    if (action === "suspendre") { applyStatus(user, "suspendu"); toast.success(`${user.name} a été suspendu·e`); }
    if (action === "bannir") { applyStatus(user, "banni"); toast.success(`${user.name} a été banni·e`); }
    if (action === "reactiver") { applyStatus(user, "actif"); toast.success(`${user.name} a été réactivé·e`); }
    setConfirm(null);
  };

  let body;
  if (preview === "chargement") body = <div aria-busy className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-foreground/10" />)}</div>;
  else if (preview === "erreur") body = <ServerErrorScreen compact onRetry={() => applyPreview("liste")} />;
  else if (preview === "vide") body = <EmptyScreen compact title="Aucun utilisateur" description="Les étudiants inscrits apparaîtront ici." />;
  else if (preview === "aucun" || results.length === 0) body = <NoResultsScreen compact query={preview === "aucun" ? undefined : q} filtered={preview === "aucun" || !!statut} />;
  else body = (
    <div className="space-y-2">
      {results.map((u) => (
        <div key={u.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
          <Avatar name={u.name} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{u.name}</p>{u.verified && <BadgeCheck className="size-4 text-primary" />}<Pill tone={statusTone[u.status]}>{statusLabel[u.status]}</Pill>{u.reportsCount > 0 && <Pill tone="danger"><Flag className="size-3" />{u.reportsCount}</Pill>}</div>
            <p className="truncate text-xs text-muted-foreground">{u.email} · {u.campus} · {u.listingsCount} annonce{u.listingsCount > 1 ? "s" : ""} · inscrit le {u.joinedLabel}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions pour ${u.name}`}><MoreVertical className="size-5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!u.verified && <DropdownMenuItem onSelect={() => verify(u)}><Shield /> Vérifier le compte</DropdownMenuItem>}
              {u.status !== "actif" && <DropdownMenuItem onSelect={() => setConfirm({ user: u, action: "reactiver" })}><RefreshCw /> Réactiver</DropdownMenuItem>}
              {u.status === "actif" && <DropdownMenuItem onSelect={() => setConfirm({ user: u, action: "suspendre" })}><UserX /> Suspendre</DropdownMenuItem>}
              <DropdownMenuSeparator />
              {u.status !== "banni" && <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirm({ user: u, action: "bannir" })}><Block /> Bannir définitivement</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <PageHeader kicker="Administration" title="Utilisateurs" description="Recherchez, vérifiez et modérez les comptes étudiants." breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Utilisateurs" }]} />
      <StateSwitcher states={previews} value={preview} onChange={applyPreview} />

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un nom, un email, un campus…" aria-label="Rechercher un utilisateur" className="h-11 w-full rounded-lg border border-input bg-card pl-11 pr-9 text-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25" />
          {q && <button type="button" aria-label="Effacer" onClick={() => setQ("")} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button>}
        </div>
        <div className="flex gap-2">
          {(["actif", "suspendu", "banni"] as const).map((s) => (
            <button key={s} aria-pressed={statut === s} onClick={() => setStatut((cur) => (cur === s ? undefined : s))} className={cn("rounded-full border px-3.5 py-2 text-sm font-semibold transition", statut === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{statusLabel[s]}</button>
          ))}
        </div>
      </div>

      <p className="mb-4 mt-4 text-sm text-muted-foreground" aria-live="polite">{preview !== "aucun" && preview !== "vide" && <><span className="font-bold text-foreground">{results.length}</span> utilisateur{results.length > 1 ? "s" : ""}</>}</p>
      {body}

      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.action === "bannir" ? `Bannir ${confirm.user.name} ?` : confirm?.action === "suspendre" ? `Suspendre ${confirm.user.name} ?` : `Réactiver ${confirm?.user.name} ?`}
        description={confirm?.action === "bannir" ? "Cette action bloque définitivement l'accès au compte et retire ses annonces. Elle peut être annulée manuellement plus tard." : confirm?.action === "suspendre" ? "L'utilisateur ne pourra plus se connecter tant que le compte est suspendu." : "L'utilisateur retrouve un accès normal à son compte."}
        confirmLabel={confirm?.action === "bannir" ? "Bannir" : confirm?.action === "suspendre" ? "Suspendre" : "Réactiver"}
        destructive={confirm?.action !== "reactiver"} onConfirm={runConfirm} />
    </div>
  );
}
