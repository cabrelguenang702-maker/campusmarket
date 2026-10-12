import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, IconInput } from "@/components/cm/forms";
import { StateScreen } from "@/components/cm/feedback";
import { CheckCircle, Lock, Paperclip, Send, Tag, X } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { useAuth } from "@/lib/auth";
import { supportError, useFaq, useSupportActions, validateAttachment } from "@/lib/api/support";

type Step = "form" | "succes";

export function NewTicketDialog({ open, onOpenChange, defaultCategory }: { open: boolean; onOpenChange: (o: boolean) => void; defaultCategory?: string | undefined }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const faq = useFaq();
  const { create } = useSupportActions(userId);
  const [step, setStep] = useState<Step>("form");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState(defaultCategory ?? "");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => { setStep("form"); setSubject(""); setCategory(defaultCategory ?? ""); setMessage(""); setFile(null); setError(null); setNewId(null); create.reset(); };

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    const problem = validateAttachment(f);
    if (problem) { setError(problem); return; }
    setError(null);
    setFile(f);
  };

  const submit = () => {
    if (subject.trim().length < 3 || !category || message.trim().length < 10) { setError("Complétez le sujet, la catégorie et décrivez votre problème en au moins 10 caractères."); return; }
    setError(null);
    create.mutate({ category, subject: subject.trim(), body: message.trim(), file }, {
      onSuccess: (r) => {
        setNewId(r.id);
        setStep("succes");
        if (r.attachmentFailed) toast.warning("Ticket envoyé, mais pas la capture", { description: "Vous pouvez la joindre depuis la conversation du ticket." });
      },
      onError: (e) => setError(supportError(e, "Envoi impossible. Réessayez dans un instant.")),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) window.setTimeout(reset, 200); }}>
      <DialogContent className="max-w-md">
        {!session ? (
          <>
            <DialogTitle className="sr-only">Connexion requise</DialogTitle>
            <DialogDescription className="sr-only">Connectez-vous pour contacter le support.</DialogDescription>
            <StateScreen compact icon={Lock} title="Connectez-vous pour contacter le support" description="Votre ticket est rattaché à votre compte : c'est ainsi que nous pouvons vous répondre." actions={<Button asChild size="lg"><AppLink to="/connexion" onClick={() => onOpenChange(false)}>Se connecter</AppLink></Button>} />
          </>
        ) : step === "succes" && newId ? (
          <>
            <DialogTitle className="sr-only">Ticket envoyé</DialogTitle>
            <DialogDescription className="sr-only">Votre ticket a été créé.</DialogDescription>
            <StateScreen compact icon={CheckCircle} tone="success" title="Votre demande a été envoyée" description="Notre équipe vous répond dès que possible. Vous recevrez une notification à la première réponse." />
            <div className="flex gap-2.5"><Button asChild className="flex-1"><AppLink to={`/aide/${newId}`} onClick={() => onOpenChange(false)}>Voir mon ticket</AppLink></Button><Button variant="outline" onClick={() => onOpenChange(false)}>Fermer</Button></div>
          </>
        ) : (
          <>
            <DialogHeader><DialogTitle className="font-display">Contacter le support</DialogTitle><DialogDescription>Décrivez votre problème, nous revenons vers vous dès que possible.</DialogDescription></DialogHeader>
            <Field label="Sujet" htmlFor="tk-sujet"><IconInput id="tk-sujet" icon={Tag} maxLength={200} placeholder="Ex. Paiement débité mais billet non reçu" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
            <Field label="Catégorie" htmlFor="tk-cat"><Select value={category} onValueChange={setCategory}><SelectTrigger id="tk-cat" className="h-11 bg-card"><SelectValue placeholder="Choisir une catégorie" /></SelectTrigger><SelectContent>{(faq.data?.categories ?? []).map((c) => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Décrivez votre problème" htmlFor="tk-msg" hint="Ajoutez la référence de paiement ou le nom de l'annonce si utile."><Textarea id="tk-msg" className="min-h-28" maxLength={4000} placeholder="Expliquez ce qui s'est passé…" value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" aria-label="Joindre un fichier" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
            {file ? (
              <p className="flex items-center gap-2 self-start text-sm font-semibold text-primary"><Paperclip className="size-4" /><span className="max-w-[16rem] truncate">{file.name}</span><button type="button" aria-label="Retirer la pièce jointe" onClick={() => setFile(null)} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button></p>
            ) : (
              <button type="button" onClick={() => fileInput.current?.click()} className="flex items-center gap-2 self-start text-sm font-semibold text-primary hover:underline"><Paperclip className="size-4" /> Joindre une capture d'écran ou un PDF</button>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button size="lg" className="w-full" onClick={submit} disabled={create.isPending}><Send /> {create.isPending ? "Envoi…" : "Envoyer ma demande"}</Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
