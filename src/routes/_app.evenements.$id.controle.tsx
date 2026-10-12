import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CheckCircle, Lock, Search, Ticket, Users, XCircle } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Avatar } from "@/components/cm/commerce";
import { IconInput } from "@/components/cm/forms";
import { Spinner, StateScreen } from "@/components/cm/feedback";
import { NetworkErrorScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { ScannerFrame } from "@/components/events/ScannerFrame";
import { PageHeader } from "@/components/layout/PageHeader";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { codeFromScan, useAttendees, useEvent, useScan, type Attendee } from "@/lib/api/events";
import { checkMessages, type CheckResult } from "@/lib/events-model";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/evenements/$id/controle")({
  head: () => ({ meta: [{ title: "Contrôle des billets — CampusMarket" }] }),
  component: TicketControlPage,
});

function TicketControlPage() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const eventQuery = useEvent(id);
  const event = eventQuery.data;
  const isOrganizer = !!event && event.createdBy === session?.user.id;
  const attendeesQuery = useAttendees(id, isOrganizer);
  const scan = useScan(id);
  const [mode, setMode] = useState<"scanner" | "manuel">("scanner");
  const [code, setCode] = useState("");
  const [q, setQ] = useState("");
  const [last, setLast] = useState<{ result: CheckResult; attendee: Attendee | undefined } | null>(null);

  const header = <PageHeader kicker="Contrôle d'accès" title={event ? `Billets — ${event.name}` : "Contrôle des billets"} breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Événements", to: "/evenements" }, ...(event ? [{ label: event.name, to: `/evenements/${event.id}` }] : []), { label: "Contrôle" }]} />;

  if (eventQuery.isPending) return <div>{header}<div className="grid place-items-center py-16"><Spinner className="size-6" /></div></div>;
  if (eventQuery.isError) return <div>{header}{isNetworkError(eventQuery.error) ? <NetworkErrorScreen compact onRetry={() => void eventQuery.refetch()} /> : <ServerErrorScreen compact onRetry={() => void eventQuery.refetch()} />}</div>;
  if (!event) return <div>{header}<StateScreen icon={Search} title="Événement introuvable" description="Impossible de contrôler les billets d'un événement qui n'existe pas." actions={<Button asChild size="lg"><AppLink to="/evenements">Voir les événements</AppLink></Button>} /></div>;
  if (!isOrganizer) return <div>{header}<StateScreen icon={Lock} tone="warning" title="Accès réservé à l'organisateur" description="Seul l'organisateur de l'événement peut contrôler les billets." actions={<Button asChild size="lg"><AppLink to={`/evenements/${event.id}`}>Retour à l'événement</AppLink></Button>} /></div>;

  const attendees = attendeesQuery.data ?? [];
  const total = attendees.length;
  const checked = attendees.filter((a) => a.status === "used").length;
  const filtered = attendees.filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()));

  const run = (raw: string) => {
    const c = codeFromScan(raw);
    if (!c || scan.isPending) return;
    const attendee = attendees.find((a) => a.code?.toLowerCase() === c);
    scan.mutate(c, {
      onSuccess: (result) => { setLast({ result, attendee }); setCode(""); },
      onError: (e) => toast.error("Contrôle impossible", { description: friendlyError(e) }),
    });
  };

  const shown = last ? checkMessages[last.result] : null;

  return (
    <div>
      {header}
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-border bg-card p-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Ticket className="size-6" /></span>
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{checked} / {total} billets contrôlés</p><div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${total ? (checked / total) * 100 : 0}%` }} /></div></div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div role="tablist" className="inline-flex rounded-lg border border-border bg-secondary p-1">
            {([["scanner", "Scanner"], ["manuel", "Saisie manuelle"]] as const).map(([k, label]) => <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={cn("rounded-md px-3.5 py-1.5 text-sm font-semibold", mode === k ? "bg-card shadow-soft" : "text-muted-foreground")}>{label}</button>)}
          </div>

          {mode === "manuel" ? (
            <div className="space-y-3 rounded-xl border border-border bg-card p-5">
              <p className="text-sm text-muted-foreground">Saisissez ou collez le code imprimé sous le QR du billet.</p>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(code); }}>
                <IconInput icon={Ticket} placeholder="Code du billet" value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" autoCapitalize="none" autoCorrect="off" />
                <Button type="submit" disabled={!code.trim() || scan.isPending}>Valider</Button>
              </form>
            </div>
          ) : (
            <ScannerFrame onScan={run} paused={scan.isPending} />
          )}

          {shown && (
            <div role="status" className={cn("flex items-start gap-3 rounded-xl border p-4", shown.tone === "success" ? "border-success/30 bg-success/10" : shown.tone === "warning" ? "border-warning/30 bg-warning/10" : "border-destructive/30 bg-destructive/10")}>
              {shown.tone === "success" ? <CheckCircle className="size-6 shrink-0 text-success" /> : shown.tone === "warning" ? <Ticket className="size-6 shrink-0 text-warning" /> : <XCircle className="size-6 shrink-0 text-destructive" />}
              <div><p className="font-semibold">{shown.title}</p>{last?.attendee && <p className="text-sm text-muted-foreground">{last.attendee.name}</p>}<p className="text-sm text-muted-foreground">{shown.detail}</p></div>
            </div>
          )}
        </div>

        <div>
          <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Users className="size-4" /> Participants ({total})</p>
          <IconInput icon={Search} placeholder="Rechercher un participant…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
          {attendeesQuery.isPending ? <div className="grid place-items-center py-8"><Spinner className="size-5" /></div>
            : attendeesQuery.isError ? <ServerErrorScreen compact onRetry={() => void attendeesQuery.refetch()} />
            : total === 0 ? <StateScreen compact icon={Users} title="Aucun participant" description="Les inscrits apparaîtront ici dès qu'ils auront un billet valide." />
            : filtered.length === 0 ? <NoResultsScreen compact query={q || undefined} />
            : (
              <ul className="max-h-[28rem] space-y-1.5 overflow-y-auto">
                {filtered.map((a) => (
                  <li key={a.ticketId} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5">
                    <Avatar name={a.name} size="sm" src={a.avatarUrl} />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{a.name}</p><p className="text-xs text-muted-foreground">{a.status === "used" ? "Contrôlé" : "Pas encore contrôlé"}</p></div>
                    {a.status === "used" ? <CheckCircle className="size-5 shrink-0 text-success" /> : <Button size="sm" variant="outline" disabled={scan.isPending || !a.code} onClick={() => a.code && run(a.code)}>Contrôler</Button>}
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
    </div>
  );
}
