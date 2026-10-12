import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { ChevronRight } from "@/components/icons";
import { categoryIcon } from "@/components/support/category-icon";
import { timeAgo } from "@/lib/domain";
import { ticketStatusLabel, type Ticket } from "@/lib/api/support";

const statusTone = { ouvert: "primary", en_attente: "warning", resolu: "success", ferme: "neutral" } as const;

export function TicketRow({ ticket }: { ticket: Ticket }) {
  const Icon = categoryIcon(ticket.category);
  return (
    <AppLink to={`/aide/${ticket.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition hover:border-primary/40 hover:shadow-glow">
      <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><p className="truncate font-semibold">{ticket.subject}</p><Pill tone={statusTone[ticket.status]}>{ticketStatusLabel[ticket.status]}</Pill></div>
        {ticket.lastPreview && <p className="mt-1 truncate text-sm text-muted-foreground">{ticket.lastPreview}</p>}
        <p className="mt-1 text-xs text-muted-foreground">Mis à jour {timeAgo(ticket.lastMessageAt)}</p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
    </AppLink>
  );
}
