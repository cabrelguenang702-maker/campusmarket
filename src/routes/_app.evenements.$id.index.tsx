import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertCircle, CalendarDays, MapPin, ScanQr, Search, Share, Ticket, Users } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { ConfirmDialog, InlineAlert, StateScreen } from "@/components/cm/feedback";
import { NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { ETicket } from "@/components/events/ETicket";
import { TicketDialog } from "@/components/events/TicketDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { useEvent, useEventActions, useMyTickets } from "@/lib/api/events";
import { formatFcfa } from "@/lib/domain";
import { remaining } from "@/lib/events-model";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app/evenements/$id/")({
  head: () => ({ meta: [{ title: "Événement — CampusMarket" }] }),
  component: EventDetailPage,
});

function EventDetailPage() {
  const { id } = Route.useParams();
  const { session, account } = useAuth();
  const userId = session?.user.id;
  const eventQuery = useEvent(id);
  const event = eventQuery.data;
  const tickets = useMyTickets(userId).data ?? [];
  const actions = useEventActions(userId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirm, setConfirm] = useState<"cancel-ticket" | "cancel-event" | null>(null);

  const crumbs = [{ label: "Accueil", to: "/" }, { label: "Événements", to: "/evenements" }, { label: event?.name ?? "Détail" }];
  const bare = <PageHeader title="" className="mb-4 [&_h1]:hidden" breadcrumbs={crumbs} />;

  if (eventQuery.isPending) return <div>{bare}<div aria-busy className="grid gap-8 lg:grid-cols-[1fr_360px]"><div className="space-y-4"><div className="h-56 animate-pulse rounded-2xl bg-foreground/10" /><div className="h-24 animate-pulse rounded-xl bg-foreground/10" /></div><div className="h-48 animate-pulse rounded-xl bg-foreground/10" /></div></div>;
  if (eventQuery.isError) return <div>{bare}{isNetworkError(eventQuery.error) ? <NetworkErrorScreen compact onRetry={() => void eventQuery.refetch()} /> : <ServerErrorScreen compact onRetry={() => void eventQuery.refetch()} />}</div>;
  if (!event) return <div>{bare}<StateScreen icon={Search} title="Événement introuvable" description="Cet événement n'existe pas ou a été retiré." actions={<Button asChild size="lg"><AppLink to="/evenements">Voir les événements</AppLink></Button>} /></div>;

  const isOrganizer = event.createdBy === userId;
  const ticket = tickets.find((t) => t.eventId === event.id);
  const hasTicket = ticket?.status === "valid" || ticket?.status === "used";
  const left = remaining(event);
  const Icon = event.icon;
  const draft = event.dbStatus === "draft";
  const fail = (title: string) => (e: unknown) => toast.error(title, { description: friendlyError(e) });

  let ticketingCard;
  if (draft) ticketingCard = <InlineAlert tone="warning" title="Brouillon">Cet événement n'est visible que par vous. Publiez-le pour ouvrir la billetterie.</InlineAlert>;
  else if (event.status === "annule") ticketingCard = <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="size-5 shrink-0" /><p>Cet événement a été annulé par l'organisateur.</p></div>;
  else if (hasTicket && ticket?.code) ticketingCard = (
    <div className="space-y-3">
      <ETicket event={event} code={ticket.code} holder={account?.profile.fullName ?? ""} status={ticket.status} />
      {ticket.status === "valid" && event.status !== "termine" && <Button variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={() => setConfirm("cancel-ticket")}>Annuler mon inscription</Button>}
    </div>
  );
  else if (event.status === "termine") ticketingCard = <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">Cet événement est déjà passé.</div>;
  else if (left === 0 && ticket?.status !== "pending_payment") ticketingCard = <div className="rounded-xl border border-border bg-card p-4 text-center"><p className="font-semibold">Billetterie complète</p><p className="mt-1 text-sm text-muted-foreground">Toutes les places ont été réservées.</p></div>;
  else ticketingCard = (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{event.price === 0 ? "Participation" : "Prix du billet"}</span><span className="font-display text-2xl font-bold text-primary">{event.price === 0 ? "Gratuit" : formatFcfa(event.price)}</span></div>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="size-3.5" />{left} place{left > 1 ? "s" : ""} restante{left > 1 ? "s" : ""} sur {event.capacity}</p>
      {ticket?.status === "pending_payment" && <p className="mt-3 text-xs text-warning">Un paiement est en attente pour cet événement. Reprenez-le pour obtenir votre billet.</p>}
      <Button size="lg" className="mt-4 w-full" onClick={() => setDialogOpen(true)}><Ticket /> {ticket?.status === "pending_payment" ? "Reprendre le paiement" : event.price === 0 ? "S'inscrire" : "Réserver mon billet"}</Button>
    </div>
  );

  const statusPill = draft ? <Pill tone="warning">Brouillon</Pill> : event.status === "annule" ? <Pill tone="danger">Annulé</Pill> : event.status === "termine" ? <Pill tone="neutral">Terminé</Pill> : event.status === "complet" ? <Pill tone="warning">Complet</Pill> : <Pill tone="primary">{event.category}</Pill>;

  return (
    <div>
      <PageHeader kicker={event.category} title={event.name} breadcrumbs={crumbs}
        actions={<>
          <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(window.location.href).then(() => toast.success("Lien copié dans le presse-papiers"), () => toast.error("Copie impossible")); }}><Share /> Partager</Button>
          {isOrganizer && !draft && <Button variant="outline" asChild><AppLink to={`/evenements/${event.id}/controle`}><ScanQr /> Contrôler les billets</AppLink></Button>}
        </>} />

      {isOrganizer && (draft || (event.status !== "annule" && event.status !== "termine")) && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-primary/5 p-3">
          <p className="mr-auto text-sm font-semibold text-primary">Vous organisez cet événement</p>
          {draft && <Button size="sm" disabled={actions.setStatus.isPending} onClick={() => actions.setStatus.mutate({ eventId: event.id, status: "published" }, { onSuccess: () => toast.success("Événement publié"), onError: fail("Publication impossible") })}>Publier</Button>}
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={actions.setStatus.isPending} onClick={() => setConfirm("cancel-event")}>Annuler l'événement</Button>
        </div>
      )}

      <div className={`relative mb-6 grid h-40 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br sm:h-56 ${event.tone}`}>
        <div className="dot-grid absolute inset-0 opacity-40" /><Icon className="relative size-16 text-primary" />
        <span className="absolute left-4 top-4">{statusPill}</span>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="font-display text-lg font-bold">À propos</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{event.description}</p>
            <dl className="mt-4 space-y-2.5 text-sm">
              <div className="flex items-center gap-2"><dt><CalendarDays className="size-4 text-primary" /></dt><dd>{event.dateLabel}</dd></div>
              <div className="flex items-center gap-2"><dt><MapPin className="size-4 text-primary" /></dt><dd>{event.place} · {event.campus}{event.city && `, ${event.city}`}</dd></div>
              <div className="flex items-center gap-2"><dt><Users className="size-4 text-primary" /></dt><dd>Organisé par {event.organizer}</dd></div>
            </dl>
          </section>
          {event.program.length > 0 && (
            <section>
              <h2 className="font-display text-lg font-bold">Programme</h2>
              <ol className="mt-3 space-y-0 border-l-2 border-border pl-4">
                {event.program.map((p, i) => (
                  <li key={`${i}-${p.title}`} className="relative pb-5 last:pb-0"><span className="absolute -left-[21px] top-1 size-2.5 rounded-full bg-primary" />{p.time && <p className="text-xs font-bold uppercase tracking-wide text-primary">{p.time}</p>}<p className="text-sm font-semibold">{p.title}</p></li>
                ))}
              </ol>
            </section>
          )}
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">{ticketingCard}</aside>
      </div>

      <TicketDialog event={event} open={dialogOpen} onOpenChange={setDialogOpen} ticket={ticket} holder={account?.profile.fullName ?? ""}
        onRegisterFree={() => actions.registerFree.mutateAsync(event.id)} freeBusy={actions.registerFree.isPending} onChanged={() => void actions.refresh()} />

      <ConfirmDialog open={confirm === "cancel-ticket"} onOpenChange={(o) => !o && setConfirm(null)} destructive title="Annuler votre inscription ?" description={event.price > 0 ? "Votre place sera libérée. Le remboursement d'un billet payant n'est pas automatique : contactez le support." : "Votre place sera libérée. Vous pourrez vous réinscrire s'il reste de la place."} confirmLabel="Annuler mon inscription"
        onConfirm={() => { if (ticket) actions.cancelTicket.mutate(ticket.id, { onSuccess: () => toast("Inscription annulée"), onError: fail("Annulation impossible") }); }} />
      <ConfirmDialog open={confirm === "cancel-event"} onOpenChange={(o) => !o && setConfirm(null)} destructive title="Annuler cet événement ?" description="L'événement sera marqué comme annulé et la billetterie fermée. Cette action est définitive. Si des billets payants ont été vendus, contactez le support pour les remboursements." confirmLabel="Annuler l'événement"
        onConfirm={() => actions.setStatus.mutate({ eventId: event.id, status: "cancelled" }, { onSuccess: () => toast("Événement annulé"), onError: fail("Annulation impossible") })} />
    </div>
  );
}
