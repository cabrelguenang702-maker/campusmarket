import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/cm/badges";
import { InlineAlert, Spinner } from "@/components/cm/feedback";
import { ServerErrorScreen } from "@/components/cm/screens";
import { Bubble } from "@/components/messages/Bubble";
import { PageHeader } from "@/components/layout/PageHeader";
import { categoryIcon } from "@/components/support/category-icon";
import { CheckCircle, History, LifeBuoy, Paperclip, Search, Send, User, X } from "@/components/icons";
import { useAuth } from "@/lib/auth";
import { timeAgo } from "@/lib/domain";
import { staffStatusLabel, useAdminSupportActions, useAdminTicketMessages, useAdminTickets, useAgents, useTicketHistory, type AdminTicket, type HistoryEntry } from "@/lib/api/admin-support";
import { useFaq, validateAttachment, type TicketStatus } from "@/lib/api/support";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_admin/admin/support/")({
  head: () => ({ meta: [{ title: "Support — Administration CampusMarket" }] }),
  component: AdminSupportPage,
});

const statusTone: Record<TicketStatus, "primary" | "warning" | "success" | "neutral"> = { ouvert: "primary", en_attente: "warning", resolu: "success", ferme: "neutral" };
type Filter = "ouvert" | "en_attente" | "resolu" | "ferme" | "tous";
const FILTERS: { id: Filter; label: string }[] = [{ id: "ouvert", label: "À traiter" }, { id: "en_attente", label: "En attente" }, { id: "resolu", label: "Résolus" }, { id: "ferme", label: "Fermés" }, { id: "tous", label: "Tous" }];
const NONE = "__none__";
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const statusName = (s: string | null) => (s && s in staffStatusLabel ? staffStatusLabel[s as TicketStatus] : (s ?? "—"));

function historyText(h: HistoryEntry) {
  if (h.kind === "assign") return h.to ? `${h.actor} a assigné le ticket à ${h.to}${h.from ? ` (avant : ${h.from})` : ""}` : `${h.actor} a désassigné le ticket${h.from ? ` (avant : ${h.from})` : ""}`;
  return `${h.actor} : ${statusName(h.from)} → ${statusName(h.to)}`;
}

function AdminSupportPage() {
  const { session } = useAuth();
  const staffId = session?.user.id;
  const ticketsQuery = useAdminTickets();
  const agentsQuery = useAgents();
  const faq = useFaq();
  const [filter, setFilter] = useState<Filter>("ouvert");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const all = ticketsQuery.data ?? [];
  const counts = { ouvert: 0, en_attente: 0, resolu: 0, ferme: 0 } as Record<TicketStatus, number>;
  for (const t of all) counts[t.status] += 1;
  const qn = normalize(q);
  const results = all.filter((t) => (filter === "tous" || t.status === filter) && (!qn || normalize(`${t.subject} ${t.requesterName}`).includes(qn)));
  const ticket = all.find((t) => t.id === selected) ?? null;

  const header = <PageHeader kicker="Administration" title="Support" description={`Répondez aux étudiants et répartissez les tickets.${counts.ouvert > 0 ? ` ${counts.ouvert} à traiter.` : ""}`} breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Support" }]} />;

  if (ticketsQuery.isLoading) return <div>{header}<div aria-busy className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-foreground/10" />)}</div></div>;
  if (ticketsQuery.isError) return <div>{header}<ServerErrorScreen onRetry={() => void ticketsQuery.refetch()} /></div>;

  return (
    <div>
      {header}
      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <div>
          <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto" role="group" aria-label="Filtrer par statut">
            {FILTERS.map((f) => (
              <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition", filter === f.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>
                {f.label}{f.id !== "tous" && counts[f.id] > 0 ? ` (${counts[f.id]})` : ""}
              </button>
            ))}
          </div>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sujet ou nom de l'étudiant…" aria-label="Rechercher un ticket" className="h-11 w-full rounded-lg border border-input bg-card pl-11 pr-3 text-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25" />
          </div>
          {results.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{all.length === 0 ? "Aucun ticket pour l'instant." : "Aucun ticket ne correspond à ce filtre."}</p>
          ) : (
            <ul className="space-y-2">
              {results.map((t) => <TicketItem key={t.id} t={t} active={selected === t.id} onSelect={() => setSelected(t.id)} agentName={agentsQuery.data?.find((a) => a.id === t.assignedTo)?.name} />)}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          {!ticket ? (
            <div className="grid h-full min-h-64 place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground"><p className="flex items-center gap-2"><LifeBuoy className="size-4" /> Sélectionnez un ticket</p></div>
          ) : (
            <TicketDetail key={ticket.id} ticket={ticket} staffId={staffId} categoryName={faq.data?.categories.find((c) => c.slug === ticket.category)?.name} />
          )}
        </div>
      </div>
    </div>
  );
}

function TicketItem({ t, active, onSelect, agentName }: { t: AdminTicket; active: boolean; onSelect: () => void; agentName: string | undefined }) {
  const Icon = categoryIcon(t.category);
  return (
    <li>
      <button onClick={onSelect} className={cn("flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition", active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40")}>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{t.subject}</span>
          <span className="block truncate text-xs text-muted-foreground">{t.requesterName} · {timeAgo(t.lastMessageAt)}</span>
          <span className="mt-1 flex items-center gap-2"><Pill tone={statusTone[t.status]}>{staffStatusLabel[t.status]}</Pill><span className="truncate text-[11px] text-muted-foreground">{t.assignedTo ? (agentName ?? "Assigné") : "Non assigné"}</span></span>
        </span>
      </button>
    </li>
  );
}

function TicketDetail({ ticket, staffId, categoryName }: { ticket: AdminTicket; staffId: string | undefined; categoryName: string | undefined }) {
  const agents = useAgents();
  const messages = useAdminTicketMessages(ticket.id, staffId);
  const history = useTicketHistory(ticket.id);
  const acts = useAdminSupportActions(staffId);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const list = messages.data ?? [];
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [list.length]);

  const closed = ticket.status === "ferme";
  const fail = (title: string) => (e: unknown) => toast.error(title, { description: acts.errorText(e) });

  const assign = (value: string) => acts.assign.mutate({ ticketId: ticket.id, agentId: value === NONE ? null : value }, { onSuccess: () => toast.success(value === NONE ? "Ticket désassigné" : "Ticket assigné"), onError: fail("Assignation impossible") });
  const setStatus = (status: TicketStatus, done: string) => acts.status.mutate({ ticketId: ticket.id, status }, { onSuccess: () => toast.success(done), onError: fail("Changement impossible") });
  const send = () => {
    const body = text.trim();
    if ((!body && !file) || acts.reply.isPending) return;
    acts.reply.mutate({ ticketId: ticket.id, body, file }, { onSuccess: () => { setText(""); setFile(null); setFileError(null); }, onError: fail("Réponse non envoyée") });
  };
  const pickFile = (f: File | undefined) => { if (!f) return; const p = validateAttachment(f); setFileError(p); if (!p) setFile(f); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="min-w-0">
          <p className="truncate font-semibold">{ticket.subject}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"><span>{ticket.requesterName}</span><span>· Ouvert {timeAgo(ticket.createdAt)}</span>{categoryName && <span>· {categoryName}</span>}<Pill tone={statusTone[ticket.status]}>{staffStatusLabel[ticket.status]}</Pill></p>
        </div>
        <div className="flex items-center gap-2">
          <User className="size-4 text-muted-foreground" />
          <Select value={ticket.assignedTo ?? NONE} onValueChange={assign} disabled={closed || acts.assign.isPending}>
            <SelectTrigger className="h-9 w-44 bg-background text-sm" aria-label="Assigner à"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>Non assigné</SelectItem>{(agents.data ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(ticket.status === "ouvert" || ticket.status === "en_attente") && <Button size="sm" variant="outline" disabled={acts.status.isPending} onClick={() => setStatus("resolu", "Ticket marqué comme résolu")}><CheckCircle /> Marquer résolu</Button>}
        {ticket.status !== "ferme" && <Button size="sm" variant="outline" disabled={acts.status.isPending} onClick={() => setStatus("ferme", "Ticket fermé")}>Fermer</Button>}
        {(ticket.status === "ferme" || ticket.status === "resolu") && <Button size="sm" variant="outline" disabled={acts.status.isPending} onClick={() => setStatus("ouvert", "Ticket rouvert")}>Rouvrir</Button>}
      </div>
      {closed && <InlineAlert tone="neutral" title="Ticket fermé">Aucune réponse n'est possible tant qu'il n'est pas rouvert.</InlineAlert>}

      <div className="space-y-3 rounded-xl border border-border bg-card/40 p-4" role="log" aria-label="Conversation">
        {messages.isLoading && <div className="flex justify-center py-4"><Spinner className="size-5" /></div>}
        {messages.isError && <p className="text-center text-sm text-destructive">Messages indisponibles. <button className="font-semibold underline" onClick={() => void messages.refetch()}>Réessayer</button></p>}
        {list.map((m) => <Bubble key={m.id} message={m} />)}
        <div ref={endRef} />
      </div>

      {!closed && (
        <div>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" aria-label="Joindre un fichier" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
          {file && <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><Paperclip className="size-4" /><span className="max-w-[16rem] truncate">{file.name}</span><button type="button" aria-label="Retirer la pièce jointe" onClick={() => setFile(null)} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button></p>}
          {fileError && <p role="alert" className="mb-2 text-sm text-destructive">{fileError}</p>}
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <Button type="button" variant="ghost" size="icon" aria-label="Joindre un fichier" onClick={() => fileInput.current?.click()}><Paperclip className="size-5" /></Button>
            <Textarea value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Répondre à l'étudiant…" aria-label="Votre réponse" rows={2} className="max-h-40 min-h-11 flex-1 resize-none py-2.5" />
            <Button type="submit" size="icon" aria-label="Envoyer" disabled={(!text.trim() && !file) || acts.reply.isPending}>{acts.reply.isPending ? <Spinner className="size-4" label="Envoi en cours" /> : <Send className="size-5" />}</Button>
          </form>
          <p className="mt-1.5 text-xs text-muted-foreground">Votre réponse est visible par l'étudiant, qui reçoit une notification. Le ticket vous est assigné à la première réponse s'il ne l'est pas déjà.</p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><History className="size-4 text-primary" /> Historique interne</h3>
        {history.isLoading ? <p className="text-xs text-muted-foreground">Chargement…</p> : (history.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">Aucune assignation ni changement de statut pour l'instant.</p> : (
          <ul className="space-y-1.5">{(history.data ?? []).map((h, i) => <li key={`${h.at}-${i}`} className="flex items-start justify-between gap-3 text-xs text-muted-foreground"><span>{historyText(h)}</span><span className="shrink-0">{timeAgo(h.at)}</span></li>)}</ul>
        )}
      </div>
    </div>
  );
}
