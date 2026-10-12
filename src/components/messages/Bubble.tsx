import { cn } from "@/lib/utils";
import { AlertCircle, Check, Checks, Clock, File, ImageIcon } from "@/components/icons";
import { Spinner } from "@/components/cm/feedback";
import type { ChatMessage, MessageStatus } from "@/lib/api/messages";

export function StatusMark({ status }: { status: MessageStatus }) {
  switch (status) {
    case "sending": return <span className="inline-flex items-center gap-1"><Spinner className="size-3 border-[1.5px]" label="Envoi en cours" /> Envoi…</span>;
    case "sent": return <span className="inline-flex items-center gap-1"><Check className="size-3.5" /> Envoyé</span>;
    case "delivered": return <span className="inline-flex items-center gap-1"><Checks className="size-3.5" /> Reçu</span>;
    case "read": return <span className="inline-flex items-center gap-1 text-primary"><Checks className="size-3.5" /> Lu</span>;
    case "failed": return <span className="inline-flex items-center gap-1 text-destructive"><AlertCircle className="size-3.5" /> Échec de l'envoi</span>;
  }
}

/** Bulle de message : texte, pièce jointe, heure et statut d'envoi. */
export function Bubble({ message, onRetry }: { message: ChatMessage; onRetry?: (() => void) | undefined }) {
  const mine = message.from === "me";
  const failed = message.status === "failed";
  return (
    <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
      <div className={cn("max-w-[82%] space-y-1.5 rounded-2xl px-3.5 py-2.5 text-sm leading-6 sm:max-w-[70%]", mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-secondary text-secondary-foreground", failed && "opacity-70 ring-1 ring-destructive")}>
        {message.attachment?.kind === "image" && (
          message.attachment.url ? (
            <a href={message.attachment.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg"><img src={message.attachment.url} alt={message.attachment.name} loading="lazy" className="max-h-60 w-52 object-cover" /></a>
          ) : (
            <div className="grid h-36 w-52 place-items-center overflow-hidden rounded-lg bg-gradient-to-br from-cyan-400/40 to-blue-800/40" role="img" aria-label={message.attachment.name}><ImageIcon className="size-10 opacity-70" /></div>
          )
        )}
        {message.attachment?.kind === "file" && (
          <a href={message.attachment.url} target="_blank" rel="noreferrer" className={cn("flex items-center gap-2.5 rounded-lg p-2", mine ? "bg-primary-foreground/15" : "bg-background/60")}>
            <span className="grid size-9 place-items-center rounded-md bg-background/70 text-primary"><File className="size-5" /></span>
            <span className="min-w-0"><span className="block truncate text-[13px] font-semibold">{message.attachment.name}</span><span className="block text-[11px] opacity-70">{message.attachment.size}</span></span>
          </a>
        )}
        {message.attachment && <p className="sr-only">Pièce jointe : {message.attachment.name}</p>}
        {message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>}
      </div>
      <div className="mt-1 flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
        <span>{message.time}</span>
        {mine && message.status && <StatusMark status={message.status} />}
        {failed && onRetry && <button onClick={onRetry} className="font-semibold text-primary hover:underline">Réessayer</button>}
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex items-start" aria-label="Votre correspondant écrit un message" role="status">
      <div className="flex gap-1 rounded-2xl rounded-bl-md bg-secondary px-4 py-3">
        {[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 0.15}s` }} />)}
      </div>
    </div>
  );
}
