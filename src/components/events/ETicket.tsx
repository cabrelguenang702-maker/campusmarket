import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CalendarDays, MapPin, Printer, Share } from "@/components/icons";
import { Pill } from "@/components/cm/badges";
import { QrCode } from "@/components/cm/qr";
import { ticketPayload } from "@/lib/api/events";
import { cn } from "@/lib/utils";
import type { EventItem, TicketStatus } from "@/lib/events-model";

/** Billet électronique : le QR code contient le jeton du billet, contrôlé à l'entrée par l'organisateur. */
export function ETicket({ event, code, holder, status = "valid" }: { event: EventItem; code: string; holder: string; status?: TicketStatus }) {
  const Icon = event.icon;
  const used = status === "used";
  return (
    <div className="print-area overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className={cn("relative flex items-center gap-3 bg-gradient-to-br p-5", event.tone)}>
        <div className="dot-grid absolute inset-0 opacity-40" />
        <span className="relative grid size-12 shrink-0 place-items-center rounded-xl bg-background/80 text-primary"><Icon className="size-6" /></span>
        <div className="relative min-w-0">
          <p className="truncate font-display text-lg font-bold">{event.name}</p>
          <p className="text-xs text-foreground/80">{event.organizer}</p>
        </div>
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="space-y-2.5 text-sm">
          <p className="flex items-center gap-2"><CalendarDays className="size-4 shrink-0 text-primary" />{event.dateLabel}</p>
          <p className="flex items-center gap-2"><MapPin className="size-4 shrink-0 text-primary" />{event.place} · {event.campus}, {event.city}</p>
          <p className="pt-1 text-xs text-muted-foreground">Titulaire</p>
          <p className="font-semibold">{holder}</p>
          {used && <Pill tone="neutral">Billet déjà utilisé</Pill>}
        </div>
        <div className={cn("mx-auto rounded-lg border border-border bg-white p-2 sm:mx-0", used && "opacity-40")}><QrCode value={ticketPayload(code)} size={144} label={`QR code du billet pour ${event.name}`} /></div>
      </div>
      <div className="border-t border-dashed border-border px-5 py-3 text-center"><p className="break-all font-mono text-[11px] tracking-wider text-muted-foreground">{code}</p></div>
      <div className="flex gap-2 border-t border-border p-4 print:hidden">
        <Button variant="outline" className="flex-1" onClick={() => window.print()}><Printer /> Imprimer</Button>
        <Button variant="outline" className="flex-1" onClick={() => { void navigator.clipboard?.writeText(code); toast.success("Code copié"); }}><Share /> Copier le code</Button>
      </div>
    </div>
  );
}
