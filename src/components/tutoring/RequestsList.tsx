import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/cm/feedback";
import { EmptyScreen, NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { AppLink } from "@/components/cm/app-link";
import { CalendarDays, Clock, MapPin } from "@/components/icons";
import { isNetworkError, friendlyError } from "@/lib/api/errors";
import { formatFcfa } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { MODE_LABEL, durationLabel, useMyRequests, useTutoringActions, type TutoringRequest } from "@/lib/api/tutoring";
import { useAuth } from "@/lib/auth";
import { RespondDialog, ReviewDialog, TutoringPayDialog } from "./RequestDialogs";

const whenFmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const isWebLink = (s: string) => /^https?:\/\/\S+$/i.test(s);
const H72 = 72 * 3_600_000;

function statusOf(r: TutoringRequest): { label: string; tone: "info" | "good" | "warn" | "muted" } {
  switch (r.status) {
    case "pending": return { label: "En attente de réponse", tone: "info" };
    case "accepted": return r.paymentStatus === "unpaid" ? { label: "À payer", tone: "warn" } : { label: "Confirmée", tone: "good" };
    case "declined": return { label: "Refusée", tone: "muted" };
    case "cancelled": return { label: r.refundStatus === "due" ? "Annulée · remboursement en cours" : r.refundStatus === "done" ? "Annulée · remboursée" : "Annulée", tone: r.refundStatus === "due" ? "warn" : "muted" };
    case "completed": return { label: "Terminée", tone: "good" };
  }
}
const toneClass = { info: "border-primary/40 bg-primary/10 text-primary", good: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", warn: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400", muted: "border-border bg-secondary text-muted-foreground" } as const;

type Dialogs = { respond: { request: TutoringRequest; accept: boolean } | null; review: TutoringRequest | null; pay: TutoringRequest | null; cancel: TutoringRequest | null; complete: TutoringRequest | null };

function RequestCard({ r, role, open }: { r: TutoringRequest; role: "student" | "tutor"; open: (d: Partial<Dialogs>) => void }) {
  const now = Date.now();
  const passed = r.scheduledAt !== null && new Date(r.scheduledAt).getTime() <= now;
  const paidOrFree = r.price === 0 || r.paymentStatus === "paid";
  const payOpen = r.status === "accepted" && r.paymentStatus === "unpaid" && r.payBy !== null && new Date(r.payBy).getTime() > now;
  const tutorCanComplete = r.status === "accepted" && passed && paidOrFree && (r.price === 0 || now >= new Date(r.scheduledAt!).getTime() + H72);
  const studentCanComplete = r.status === "accepted" && passed && paidOrFree;
  const st = statusOf(r);
  const other = role === "student" ? { name: r.tutorName, id: r.tutorId } : { name: r.studentName, id: r.studentId };

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-base font-bold">{r.subject} <span className="font-normal text-muted-foreground">avec</span> {role === "student" ? <AppLink to={`/tutorat/${other.id}`} className="hover:text-primary hover:underline">{other.name}</AppLink> : other.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{MODE_LABEL[r.mode]} · {durationLabel(r.durationMinutes)} · {r.price > 0 ? formatFcfa(r.price) : "Gratuit"}</p>
        </div>
        <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", toneClass[st.tone])}>{st.label}</span>
      </div>
      {r.message && <p className="mt-2 text-sm">« {r.message} »</p>}
      {r.status === "pending" && r.proposedAt && <p className="mt-2 text-sm text-muted-foreground">Créneau souhaité : <span className="capitalize">{whenFmt(r.proposedAt)}</span></p>}
      {r.scheduledAt && r.status !== "declined" && (
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5 capitalize"><CalendarDays className="size-4" /> {whenFmt(r.scheduledAt)}</span>
          <span className="flex items-center gap-1.5"><Clock className="size-4" /> {durationLabel(r.durationMinutes)}</span>
          {r.location && <span className="flex min-w-0 items-center gap-1.5"><MapPin className="size-4 shrink-0" />{isWebLink(r.location) ? <a href={r.location} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">Rejoindre en ligne</a> : <span>{r.location}</span>}</span>}
        </p>
      )}
      {r.tutorNote && <p className="mt-2 rounded-lg bg-secondary p-2.5 text-sm"><span className="font-semibold">Message du tuteur : </span>{r.tutorNote}</p>}
      {r.status === "accepted" && r.paymentStatus === "unpaid" && !payOpen && <p className="mt-2 text-sm text-destructive">Le délai de paiement est dépassé : la séance sera annulée automatiquement.</p>}
      {role === "tutor" && r.status === "accepted" && r.paymentStatus === "unpaid" && payOpen && <p className="mt-2 text-sm text-muted-foreground">En attente du paiement de l'élève.</p>}
      {role === "tutor" && r.status === "accepted" && r.price > 0 && r.paymentStatus === "paid" && passed && !tutorCanComplete && <p className="mt-2 text-sm text-muted-foreground">L'élève confirme la fin de séance ; vous pourrez la clôturer 72 h après l'heure prévue.</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {role === "tutor" && r.status === "pending" && <><Button size="sm" onClick={() => open({ respond: { request: r, accept: true } })}>Accepter</Button><Button size="sm" variant="outline" onClick={() => open({ respond: { request: r, accept: false } })}>Refuser</Button></>}
        {role === "student" && payOpen && <Button size="sm" onClick={() => open({ pay: r })}>Payer {formatFcfa(r.price)}</Button>}
        {role === "student" && studentCanComplete && <Button size="sm" onClick={() => open({ complete: r })}>Séance effectuée</Button>}
        {role === "tutor" && tutorCanComplete && <Button size="sm" onClick={() => open({ complete: r })}>Marquer comme terminée</Button>}
        {role === "student" && r.status === "completed" && !r.reviewed && <Button size="sm" variant="outline" onClick={() => open({ review: r })}>Noter la séance</Button>}
        {((role === "student" && (r.status === "pending" || r.status === "accepted")) || (role === "tutor" && r.status === "accepted")) && <Button size="sm" variant="ghost" onClick={() => open({ cancel: r })}>Annuler</Button>}
      </div>
    </li>
  );
}

export function RequestsList() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const query = useMyRequests(userId);
  const acts = useTutoringActions();
  const [dlg, setDlg] = useState<Dialogs>({ respond: null, review: null, pay: null, cancel: null, complete: null });
  const open = (d: Partial<Dialogs>) => setDlg((prev) => ({ ...prev, ...d }));
  const close = () => setDlg({ respond: null, review: null, pay: null, cancel: null, complete: null });

  if (query.isPending) return <div aria-busy className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-foreground/10" />)}</div>;
  if (query.isError) return isNetworkError(query.error) ? <NetworkErrorScreen compact onRetry={() => void query.refetch()} /> : <ServerErrorScreen compact onRetry={() => void query.refetch()} />;
  const all = query.data ?? [];
  const received = all.filter((r) => r.tutorId === userId);
  const sent = all.filter((r) => r.studentId === userId);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.success(ok); } catch (e) { toast.error(friendlyError(e, "Action impossible. Réessayez dans un instant.")); }
    close();
  };

  if (all.length === 0) return <EmptyScreen compact title="Aucune demande pour l'instant" description="Demandez une séance à un tuteur depuis l'annuaire, ou devenez tuteur pour recevoir des demandes." />;

  return (
    <div className="space-y-8">
      {received.length > 0 && (
        <section aria-labelledby="recues"><h2 id="recues" className="mb-3 font-display text-lg font-bold">Demandes reçues</h2>
          <ul className="space-y-3">{received.map((r) => <RequestCard key={r.id} r={r} role="tutor" open={open} />)}</ul></section>
      )}
      {sent.length > 0 && (
        <section aria-labelledby="envoyees"><h2 id="envoyees" className="mb-3 font-display text-lg font-bold">Mes demandes</h2>
          <ul className="space-y-3">{sent.map((r) => <RequestCard key={r.id} r={r} role="student" open={open} />)}</ul></section>
      )}

      <RespondDialog request={dlg.respond?.request ?? null} accept={dlg.respond?.accept ?? true} onClose={close} />
      <ReviewDialog request={dlg.review} onClose={close} />
      <TutoringPayDialog request={dlg.pay} onClose={close} />
      <ConfirmDialog open={dlg.cancel !== null} onOpenChange={(o) => !o && close()} title="Annuler cette séance ?" destructive confirmLabel="Annuler la séance"
        description={dlg.cancel?.paymentStatus === "paid" ? "La séance est déjà payée : l'élève sera remboursé par l'équipe CampusMarket." : "L'autre personne sera prévenue."}
        onConfirm={() => { const r = dlg.cancel; if (r) void run(() => acts.cancel.mutateAsync(r.id), "Séance annulée."); }} />
      <ConfirmDialog open={dlg.complete !== null} onOpenChange={(o) => !o && close()} title="Confirmer que la séance a eu lieu ?" confirmLabel="Oui, séance effectuée"
        description={dlg.complete && dlg.complete.price > 0 && dlg.complete.studentId === userId ? `Le tuteur sera crédité de sa part. Si la séance n'a pas eu lieu, annulez-la plutôt pour être remboursé.` : "Elle sera marquée comme terminée."}
        onConfirm={() => { const r = dlg.complete; if (r) void run(() => acts.complete.mutateAsync(r.id), "Séance terminée."); }} />
    </div>
  );
}
