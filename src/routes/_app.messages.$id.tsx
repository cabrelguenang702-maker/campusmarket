import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Archive, ArrowLeft, BadgeCheck, Block, File, Flag, ImageIcon, LockOpen, MessageCircle, MoreVertical, Paperclip, Send, Store, Trash, WifiOff } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { Avatar, Price } from "@/components/cm/commerce";
import { ReportDialog } from "@/components/cm/ReportDialog";
import { ConfirmDialog, InlineAlert, StateScreen } from "@/components/cm/feedback";
import { NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { Bubble, TypingIndicator } from "@/components/messages/Bubble";
import { categoryOf } from "@/lib/domain";
import { formatSize, useConversation, useMessageActions, useThreadMessages, useTyping, validateAttachment, type ChatMessage } from "@/lib/api/messages";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/messages/$id")({
  component: ThreadRoute,
});

type Pending = { id: string; text: string; file: File | null; status: "sending" | "failed"; createdAt: string };

function ThreadRoute() {
  const { id } = Route.useParams();
  return <Thread key={id} id={id} />;
}

function Thread({ id }: { id: string }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const convQuery = useConversation(id, userId);
  const conv = convQuery.data ?? undefined;
  const messagesQuery = useThreadMessages(id, userId, conv?.clearedBefore, !!conv);
  const actions = useMessageActions(userId);
  const { typing, notify } = useTyping(id, userId);

  const [text, setText] = useState("");
  const [attach, setAttach] = useState<{ file: File; url: string | null } | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [confirm, setConfirm] = useState<"bloquer" | "supprimer" | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Marque les messages reçus comme lus tant que la conversation est ouverte et visible.
  const unread = conv?.unread ?? 0;
  useEffect(() => {
    if (unread > 0 && userId && document.visibilityState === "visible") actions.read.mutate(id);
  }, [unread, id, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const messages: ChatMessage[] = [
    ...(messagesQuery.data ?? []),
    ...pending.map((p): ChatMessage => ({ id: p.id, from: "me", time: "À l'instant", createdAt: p.createdAt, status: p.status, ...(p.text ? { text: p.text } : {}), ...(p.file ? { attachment: { kind: p.file.type.startsWith("image/") ? "image" as const : "file" as const, name: p.file.name, size: formatSize(p.file.size) } } : {}) })),
  ];
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, typing]);

  if (convQuery.isLoading) {
    return <div className="grid flex-1 place-items-center"><div className="space-y-4 p-6" aria-busy>{[["w-48", false], ["w-36", true], ["w-56", false]].map(([w, mine], i) => <div key={i} className={cn("flex", mine ? "justify-end" : "")}><div className={cn("h-11 animate-pulse rounded-2xl bg-foreground/10", w as string)} /></div>)}</div></div>;
  }
  if (convQuery.isError) {
    return <div className="grid flex-1 place-items-center">{isNetworkError(convQuery.error) ? <NetworkErrorScreen compact onRetry={() => void convQuery.refetch()} /> : <ServerErrorScreen compact onRetry={() => void convQuery.refetch()} />}</div>;
  }
  if (!conv) {
    return <div className="grid flex-1 place-items-center"><StateScreen compact icon={MessageCircle} tone="neutral" title="Conversation introuvable" description="Cette conversation n'existe pas ou a été supprimée." actions={<Button asChild><AppLink to="/messages">Retour aux messages</AppLink></Button>} /></div>;
  }

  const closed = conv.blockedByMe || conv.blockedMe;
  const product = conv.product;
  const ProductIcon = product ? categoryOf(product.category).icon : null;

  const deliver = async (p: Pending) => {
    try {
      await actions.send.mutateAsync({ conversationId: id, body: p.text, file: p.file });
      await qc.invalidateQueries({ queryKey: ["messages", id] });
      setPending((cur) => cur.filter((x) => x.id !== p.id));
    } catch (e) {
      setPending((cur) => cur.map((x) => (x.id === p.id ? { ...x, status: "failed" } : x)));
      toast.error(friendlyError(e, "Le message n'a pas pu être envoyé."));
    }
  };

  const send = (file?: File | null) => {
    const body = text.trim();
    if (!body && !file) return;
    const p: Pending = { id: `tmp-${crypto.randomUUID()}`, text: body, file: file ?? null, status: "sending", createdAt: new Date().toISOString() };
    setPending((cur) => [...cur, p]);
    setText(""); setAttach(null);
    if (!online) { setPending((cur) => cur.map((x) => (x.id === p.id ? { ...x, status: "failed" } : x))); return; }
    void deliver(p);
  };

  const retry = (pid: string) => {
    const p = pending.find((x) => x.id === pid);
    if (!p) return;
    const again = { ...p, status: "sending" as const };
    setPending((cur) => cur.map((x) => (x.id === pid ? again : x)));
    void deliver(again);
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const problem = validateAttachment(f);
    if (problem) return void toast.error("Pièce jointe refusée", { description: problem });
    setAttach({ file: f, url: f.type.startsWith("image/") ? URL.createObjectURL(f) : null });
  };
  const closeAttach = () => { if (attach?.url) URL.revokeObjectURL(attach.url); setAttach(null); };

  const run = (fn: () => Promise<unknown>, ok?: string) => fn().then(() => { if (ok) toast.success(ok); }).catch((e: unknown) => toast.error(friendlyError(e, "Action impossible pour le moment.")));

  return (
    <>
      <header className="flex items-center gap-3 border-b border-border px-3 py-3 sm:px-4">
        <Button asChild variant="ghost" size="icon" className="lg:hidden" aria-label="Retour aux conversations"><AppLink to="/messages"><ArrowLeft /></AppLink></Button>
        <Avatar name={conv.name} size="md" src={conv.avatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-sm font-bold">{conv.name}{conv.verified && <BadgeCheck className="size-4 shrink-0 text-primary" />}</p>
          <p className="truncate text-xs text-muted-foreground">{typing && !closed ? "écrit…" : (conv.campus ?? "Campus non renseigné")}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Options de la conversation"><MoreVertical /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild className="cursor-pointer"><AppLink to={`/boutique/${conv.otherId}`}><Store /> Voir le profil</AppLink></DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" onClick={() => void run(() => actions.archive.mutateAsync({ conversationId: id, archived: !conv.archived }), conv.archived ? "Conversation désarchivée" : "Conversation archivée")}><Archive /> {conv.archived ? "Désarchiver" : "Archiver"}</DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" onClick={() => setReportOpen(true)}><Flag /> Signaler</DropdownMenuItem>
            <DropdownMenuSeparator />
            {conv.blockedByMe
              ? <DropdownMenuItem className="cursor-pointer" onClick={() => void run(() => actions.block.mutateAsync({ otherId: conv.otherId, blocked: false }), "Utilisateur débloqué")}><LockOpen /> Débloquer l'utilisateur</DropdownMenuItem>
              : <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={() => setConfirm("bloquer")}><Block /> Bloquer l'utilisateur</DropdownMenuItem>}
            <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={() => setConfirm("supprimer")}><Trash /> Supprimer la conversation</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {product && ProductIcon && conv.productId && (
        <AppLink to={`/produit/${conv.productId}`} className="flex items-center gap-3 border-b border-border bg-secondary/40 px-4 py-2.5 transition hover:bg-secondary">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent text-primary"><ProductIcon className="size-5" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{product.name}</span><Price value={product.price} size="sm" /></span>
          <span className="text-xs font-semibold text-primary">Voir l'annonce</span>
        </AppLink>
      )}

      {(!online || conv.blockedByMe || conv.blockedMe || conv.archived) && (
        <div className="space-y-2 px-3 pt-3 sm:px-4" aria-live="polite">
          {!online && <InlineAlert tone="warning" title="Vous êtes hors connexion">Vos messages ne partiront qu'une fois le réseau rétabli : appuyez sur « Réessayer » à ce moment-là.</InlineAlert>}
          {conv.blockedByMe && <InlineAlert tone="danger" title={`Vous avez bloqué ${conv.name}`} action={<Button size="sm" variant="outline" className="shrink-0" onClick={() => void run(() => actions.block.mutateAsync({ otherId: conv.otherId, blocked: false }), "Utilisateur débloqué")}><LockOpen /> Débloquer</Button>}>Vous ne recevrez plus de messages de cet utilisateur et il ne peut plus vous écrire.</InlineAlert>}
          {conv.archived && !closed && <InlineAlert tone="neutral" title="Conversation archivée" action={<Button size="sm" variant="outline" className="shrink-0" onClick={() => void run(() => actions.archive.mutateAsync({ conversationId: id, archived: false }))}>Désarchiver</Button>}>Elle n'apparaît plus dans votre boîte principale. Un nouveau message la désarchivera.</InlineAlert>}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-4" role="log" aria-label={`Conversation avec ${conv.name}`}>
        {messagesQuery.isLoading ? (
          <div className="space-y-4" aria-busy>{[["w-2/3", false], ["w-1/2", true], ["w-3/5", false], ["w-2/5", true]].map(([w, mine], i) => <div key={i} className={cn("flex", mine ? "justify-end" : "")}><div className={cn("h-11 animate-pulse rounded-2xl bg-foreground/10", w as string)} /></div>)}</div>
        ) : messagesQuery.isError ? (
          isNetworkError(messagesQuery.error) ? <NetworkErrorScreen compact onRetry={() => void messagesQuery.refetch()} /> : <ServerErrorScreen compact onRetry={() => void messagesQuery.refetch()} />
        ) : messages.length === 0 ? (
          <div className="grid h-full place-items-center">
            <StateScreen compact icon={MessageCircle} tone="primary" title={`Démarrez la conversation avec ${conv.name.split(" ")[0]}`} description="Présentez-vous et posez votre question. Restez courtois et ne partagez pas d'informations sensibles."
              actions={<div className="flex flex-wrap justify-center gap-2">{["Bonjour, est-ce toujours disponible ?", "Le prix est-il négociable ?"].map((s) => <button key={s} onClick={() => setText(s)} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:border-primary/50">{s}</button>)}</div>} />
          </div>
        ) : (
          <>
            {messages.map((m) => <Bubble key={m.id} message={m} onRetry={m.status === "failed" ? () => retry(m.id) : undefined} />)}
            {typing && !closed && <TypingIndicator />}
          </>
        )}
        <div ref={endRef} />
      </div>

      <footer className="border-t border-border p-3 sm:p-4">
        {closed ? (
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Block className="size-4" /> Vous ne pouvez pas écrire à cet utilisateur.</p>
        ) : (
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
            <Button type="button" variant="ghost" size="icon" aria-label="Joindre un fichier" onClick={() => fileRef.current?.click()}><Paperclip className="size-5" /></Button>
            <Textarea value={text} onChange={(e) => { setText(e.target.value); if (e.target.value) notify(); }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Écrire un message…" aria-label="Votre message" rows={1} maxLength={4000} className="max-h-32 min-h-11 flex-1 resize-none py-2.5" />
            <Button type="submit" size="icon" aria-label="Envoyer" disabled={!text.trim()}><Send className="size-5" /></Button>
          </form>
        )}
      </footer>

      <Dialog open={!!attach} onOpenChange={(o) => { if (!o) closeAttach(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display">Envoyer une pièce jointe</DialogTitle><DialogDescription>Vérifiez le fichier avant de l'envoyer à {conv.name}.</DialogDescription></DialogHeader>
          {attach && (
            <div>
              {attach.url ? <img src={attach.url} alt={attach.file.name} className="max-h-64 w-full rounded-lg object-contain" /> : <div className="grid h-40 place-items-center rounded-lg bg-secondary"><File className="size-14 text-primary" /></div>}
              <p className="mt-3 flex items-center gap-1.5 truncate text-sm font-semibold">{attach.url ? <ImageIcon className="size-4 shrink-0" /> : <File className="size-4 shrink-0" />}{attach.file.name}</p>
              <p className="text-xs text-muted-foreground">{formatSize(attach.file.size)}</p>
              <Textarea className="mt-3 min-h-16" placeholder="Ajouter un message (facultatif)" value={text} onChange={(e) => setText(e.target.value)} aria-label="Légende" />
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2"><Button variant="outline" onClick={closeAttach}>Annuler</Button><Button onClick={() => { const f = attach?.file; if (f) send(f); }}><Send /> Envoyer</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} targetType="profile" targetId={conv.otherId} subject={`Conversation avec ${conv.name}`} />
      <ConfirmDialog open={confirm === "bloquer"} onOpenChange={(o) => !o && setConfirm(null)} destructive title={`Bloquer ${conv.name} ?`} description="Cette personne ne pourra plus vous écrire. Vous pourrez la débloquer à tout moment." confirmLabel="Bloquer" onConfirm={() => void run(() => actions.block.mutateAsync({ otherId: conv.otherId, blocked: true }), "Utilisateur bloqué")} />
      <ConfirmDialog open={confirm === "supprimer"} onOpenChange={(o) => !o && setConfirm(null)} destructive title="Supprimer la conversation ?" description="L'historique sera effacé de votre boîte de réception. Votre correspondant garde sa copie." confirmLabel="Supprimer" onConfirm={() => void run(() => actions.clear.mutateAsync(id), "Conversation supprimée").then(() => navigate({ to: "/messages" }))} />
    </>
  );
}
