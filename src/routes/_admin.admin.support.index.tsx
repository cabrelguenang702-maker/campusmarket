import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill } from "@/components/cm/badges";
import { ServerErrorScreen } from "@/components/cm/screens";
import { StateSwitcher } from "@/components/cm/state-switcher";
import { Bubble } from "@/components/messages/Bubble";
import { PageHeader } from "@/components/layout/PageHeader";
import { History, LifeBuoy, Search, User } from "@/components/icons";
import { faqCategories, tickets as seedTickets, ticketStatusLabel, type TicketStatus } from "@/lib/mock-support";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_admin/admin/support/")({
  head: () => ({ meta: [{ title: "Support — Administration CampusMarket" }] }),
  component: AdminSupportPage,
});

type Preview = "liste" | "recherche" | "aucun" | "vide" | "chargement" | "erreur";
const previews = [
  { id: "liste", label: "Tickets" },
  { id: "recherche", label: "Recherche" },
  { id: "aucun", label: "Aucun résultat" },
  { id: "vide", label: "Aucun ticket" },
  { id: "chargement", label: "Chargement" },
  { id: "erreur", label: "Erreur serveur" },
] as const satisfies readonly { id: Preview; label: string }[];

const statusTone: Record<TicketStatus, "primary" | "warning" | "success" | "neutral"> = { ouvert: "primary", en_attente: "warning", resolu: "success", ferme: "neutral" };
const agents = ["Non assigné", "Aline Support", "Bruno Support", "Chantal Support"];
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

type HistoryEntry = { id: string; text: string; time: string };

function AdminSupportPage() {
  const [preview, setPreview] = useState<Preview>("liste");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(seedTickets[0]?.id ?? null);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, HistoryEntry[]>>({});

  const applyPreview = (id: Preview) => { setPreview(id); if (id === "recherche") setQ("paiement"); if (id === "liste") setQ(""); };

  const qn = normalize(q);
  const results = seedTickets.filter((t) => !qn || normalize(`${t.subject} ${t.category}`).includes(qn));
  const ticket = seedTickets.find((t) => t.id === selected);

  const assign = (ticketId: string, agent: string) => {
    setAssignments((cur) => ({ ...cur, [ticketId]: agent }));
    setHistory((cur) => ({ ...cur, [ticketId]: [...(cur[ticketId] ?? []), { id: `h${Date.now()}`, text: agent === "Non assigné" ? "Ticket désassigné" : `Assigné à ${agent}`, time: "À l'instant" }] }));
    toast.success(agent === "Non assigné" ? "Ticket désassigné" : `Assigné à ${agent}`);
  };

  const header = <PageHeader kicker="Administration" title="Support" description="Suivez et répartissez les tickets envoyés par les étudiants." breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Support" }]} />;
  const switcher = <StateSwitcher states={previews} value={preview} onChange={applyPreview} />;

  if (preview === "erreur") return <div>{header}{switcher}<ServerErrorScreen onRetry={() => applyPreview("liste")} /></div>;
  if (preview === "chargement") return <div>{header}{switcher}<div aria-busy className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-foreground/10" />)}</div></div>;
  if (preview === "vide" || seedTickets.length === 0) return <div>{header}{switcher}<div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Aucun ticket pour l'instant.</div></div>;

  return (
    <div>
      {header}{switcher}
      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <div>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un ticket…" aria-label="Rechercher un ticket" className="h-11 w-full rounded-lg border border-input bg-card pl-11 pr-3 text-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25" />
          </div>
          {preview === "aucun" || results.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Aucun ticket ne correspond à cette recherche.</p>
          ) : (
            <ul className="space-y-2">
              {results.map((t) => {
                const category = faqCategories.find((c) => c.id === t.category);
                return (
                  <li key={t.id}>
                    <button onClick={() => setSelected(t.id)} className={cn("flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition", selected === t.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40")}>
                      {category && <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><category.icon className="size-4" /></span>}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{t.subject}</span></span>
                        <span className="mt-1 flex items-center gap-2"><Pill tone={statusTone[t.status]}>{ticketStatusLabel[t.status]}</Pill><span className="truncate text-[11px] text-muted-foreground">{assignments[t.id] ?? "Non assigné"}</span></span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          {!ticket ? (
            <div className="grid h-full min-h-64 place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground"><p className="flex items-center gap-2"><LifeBuoy className="size-4" /> Sélectionnez un ticket</p></div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                <div><p className="font-semibold">{ticket.subject}</p><p className="text-xs text-muted-foreground">Ouvert {ticket.createdLabel.toLowerCase()} · <Pill tone={statusTone[ticket.status]}>{ticketStatusLabel[ticket.status]}</Pill></p></div>
                <div className="flex items-center gap-2">
                  <User className="size-4 text-muted-foreground" />
                  <Select value={assignments[ticket.id] ?? "Non assigné"} onValueChange={(v) => assign(ticket.id, v)}>
                    <SelectTrigger className="h-9 w-44 bg-background text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{agents.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border bg-card/40 p-4" role="log" aria-label="Conversation">
                {ticket.messages.map((m) => <Bubble key={m.id} message={m} />)}
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><History className="size-4 text-primary" /> Historique interne</h3>
                {(history[ticket.id] ?? []).length === 0 ? <p className="text-xs text-muted-foreground">Aucune action pour l'instant.</p> : (
                  <ul className="space-y-1.5">{(history[ticket.id] ?? []).map((h) => <li key={h.id} className="flex items-center justify-between text-xs text-muted-foreground"><span>{h.text}</span><span>{h.time}</span></li>)}</ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
