import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, Lock, Paperclip, Search, Send, X } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Pill } from "@/components/cm/badges";
import { ServerErrorScreen } from "@/components/cm/screens";
import { ConfirmDialog, InlineAlert, Spinner, StateScreen } from "@/components/cm/feedback";
import { Bubble } from "@/components/messages/Bubble";
import { categoryIcon } from "@/components/support/category-icon";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAuth } from "@/lib/auth";
import { supportError, ticketStatusLabel, useFaq, useSupportActions, useTicket, useTicketMessages, validateAttachment } from "@/lib/api/support";
import { timeAgo } from "@/lib/domain";

export const Route = createFileRoute("/_app/aide/$id")({
  head: () => ({ meta: [{ title: "Ticket — Aide CampusMarket" }] }),
  component: TicketDetailPage,
});

function TicketDetailPage() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const userId = session?.user.id;
  const faq = useFaq();
  const ticketQuery = useTicket(id, userId);
  const ticket = ticketQuery.data;
  const messagesQuery = useTicketMessages(id, userId, !!ticket);
  const { send, close } = useSupportActions(userId);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const messages = messagesQuery.data ?? [];
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  const header = (title: string) => <PageHeader kicker="Support" title={title} breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Aide", to: "/aide?onglet=tickets" }, { label: title }]} />;

  if (!session) return <div>{header("Ticket")}<StateScreen icon={Lock} title="Connectez-vous pour voir ce ticket" description="Un ticket n'est visible que par son auteur." actions={<Button asChild size="lg"><AppLink to="/connexion">Se connecter</AppLink></Button>} /></div>;
  if (ticketQuery.isLoading) return <div>{header("Ticket")}<div aria-busy className="space-y-4">{[["w-2/3", false], ["w-1/2", true], ["w-3/5", false]].map(([w, mine], i) => <div key={i} className={mine ? "flex justify-end" : "flex"}><div className={`h-11 animate-pulse rounded-2xl bg-foreground/10 ${w as string}`} /></div>)}</div></div>;
  if (ticketQuery.isError) return <div>{header("Ticket")}<ServerErrorScreen compact onRetry={() => void ticketQuery.refetch()} /></div>;
  if (!ticket) return <div>{header("Ticket")}<StateScreen icon={Search} title="Ticket introuvable" description="Ce ticket n'existe pas ou ne vous appartient pas." actions={<Button asChild size="lg"><AppLink to="/aide">Retour au centre d'aide</AppLink></Button>} /></div>;

  const status = ticket.status;
  const closed = status === "ferme";
  const category = faq.data?.categories.find((c) => c.slug === ticket.category);
  const CategoryIcon = categoryIcon(ticket.category);

  const submit = () => {
    const body = text.trim();
    if ((!body && !file) || send.isPending) return;
    send.mutate({ ticketId: id, body, file }, {
      onSuccess: () => { setText(""); setFile(null); setFileError(null); },
      onError: (e) => toast.error("Envoi impossible", { description: supportError(e) }),
    });
  };

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    const problem = validateAttachment(f);
    setFileError(problem);
    if (!problem) setFile(f);
  };

  return (
    <div>
      {header(ticket.subject)}

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><CategoryIcon className="size-5" /></span>
        <div className="min-w-0 flex-1"><p className="font-semibold">{ticket.subject}</p><p className="text-xs text-muted-foreground">Ouvert {timeAgo(ticket.createdAt)}{category ? ` · ${category.name}` : ""}</p></div>
        <Pill tone={status === "resolu" ? "success" : status === "ferme" ? "neutral" : status === "en_attente" ? "warning" : "primary"}>{ticketStatusLabel[status]}</Pill>
      </div>

      {status === "resolu" && <InlineAlert tone="success" title="Notre équipe a marqué ce ticket comme résolu">Si le problème persiste, répondez ci-dessous : le ticket sera rouvert.</InlineAlert>}
      {closed && <InlineAlert tone="neutral" title="Ce ticket est fermé">Il ne peut plus recevoir de réponse. Pour une nouvelle demande, ouvrez un nouveau ticket depuis le centre d'aide.</InlineAlert>}

      <div className="mt-4 min-h-0 space-y-3 rounded-xl border border-border bg-card/40 p-3 sm:p-4" role="log" aria-label="Conversation avec le support">
        {messagesQuery.isLoading && <div className="flex justify-center py-6"><Spinner className="size-6" /></div>}
        {messagesQuery.isError && <p className="text-center text-sm text-destructive">Impossible de charger les messages. <button className="font-semibold underline" onClick={() => void messagesQuery.refetch()}>Réessayer</button></p>}
        {messages.map((m) => <Bubble key={m.id} message={m} />)}
        <div ref={endRef} />
      </div>

      {!closed && (
        <>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" aria-label="Joindre un fichier" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
          {file && <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-primary"><Paperclip className="size-4" /><span className="max-w-[16rem] truncate">{file.name}</span><button type="button" aria-label="Retirer la pièce jointe" onClick={() => setFile(null)} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button></p>}
          {fileError && <p role="alert" className="mt-2 text-sm text-destructive">{fileError}</p>}
          <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Button type="button" variant="ghost" size="icon" aria-label="Joindre un fichier" onClick={() => fileInput.current?.click()}><Paperclip className="size-5" /></Button>
            <Textarea value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} placeholder="Répondre au support…" aria-label="Votre réponse" rows={1} className="max-h-32 min-h-11 flex-1 resize-none py-2.5" />
            <Button type="submit" size="icon" aria-label="Envoyer" disabled={(!text.trim() && !file) || send.isPending}>{send.isPending ? <Spinner className="size-4" label="Envoi en cours" /> : <Send className="size-5" />}</Button>
          </form>
          <div className="mt-4 flex justify-end"><Button variant="outline" size="sm" onClick={() => setConfirmClose(true)}><CheckCircle /> Fermer le ticket</Button></div>
        </>
      )}
      {closed && <p className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Lock className="size-4" /> Ticket fermé</p>}

      <ConfirmDialog open={confirmClose} onOpenChange={setConfirmClose} title="Fermer ce ticket ?" description="Un ticket fermé ne peut plus être rouvert : si le problème revient, vous devrez en ouvrir un nouveau." confirmLabel="Fermer le ticket"
        onConfirm={() => close.mutate(id, { onSuccess: () => toast.success("Ticket fermé"), onError: (e) => toast.error("Fermeture impossible", { description: supportError(e) }) })} />
    </div>
  );
}
