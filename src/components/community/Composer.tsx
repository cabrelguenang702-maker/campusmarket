import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImageIcon, X } from "@/components/icons";
import { Avatar } from "@/components/cm/commerce";
import { LoadingButtonLabel } from "@/components/cm/feedback";
import { friendlyError } from "@/lib/api/errors";
import { checkPostImage, usePostActions } from "@/lib/api/spaces";
import { useAuth } from "@/lib/auth";

/** Zone de création de publication : texte (3000 caractères max) et une image facultative (5 Mo max). */
export function Composer({ spaceId }: { spaceId: string }) {
  const { session, account } = useAuth();
  const actions = usePostActions(spaceId, session?.user.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const name = account?.profile.fullName ?? "";
  const avatar = account?.profile.avatarUrl;

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const reset = () => { setOpen(false); setText(""); setImage(null); setPreview(null); };
  const pick = (f: File | undefined) => {
    if (!f) return;
    const problem = checkPostImage(f);
    if (problem) return void toast.error("Image refusée", { description: problem });
    setImage(f);
    setPreview(URL.createObjectURL(f));
  };
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    actions.create.mutate({ text: t, image }, {
      onSuccess: () => { toast.success("Publication envoyée"); reset(); },
      onError: (e) => toast.error("Publication non envoyée", { description: e instanceof Error && !("code" in e) ? e.message : friendlyError(e) }),
    });
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition hover:border-primary/40">
        <Avatar name={name} size="md" src={avatar} />
        <span className="flex-1 rounded-full bg-secondary px-4 py-2.5 text-sm text-muted-foreground">Quoi de neuf{name ? `, ${name.split(" ")[0]}` : ""} ?</span>
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex gap-3"><Avatar name={name} size="md" src={avatar} /><Textarea autoFocus value={text} maxLength={3000} onChange={(e) => setText(e.target.value)} placeholder="Partagez quelque chose…" className="min-h-24 flex-1" /></div>
      {preview && (
        <div className="relative mt-3 overflow-hidden rounded-lg bg-muted">
          <img src={preview} alt="Aperçu de l'image à publier" className="max-h-72 w-full object-cover" />
          <button onClick={() => { setImage(null); setPreview(null); }} aria-label="Retirer l'image" className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-background/90 text-muted-foreground hover:text-destructive"><X className="size-4" /></button>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="mt-3 flex items-center justify-between">
        <Button type="button" variant="ghost" size="sm" disabled={actions.create.isPending} onClick={() => fileRef.current?.click()} className={image ? "text-primary" : ""}><ImageIcon /> Photo</Button>
        <div className="flex gap-2"><Button variant="outline" disabled={actions.create.isPending} onClick={reset}>Annuler</Button><Button disabled={!text.trim() || actions.create.isPending} onClick={submit}><LoadingButtonLabel loading={actions.create.isPending} loadingText="Envoi…">Publier</LoadingButtonLabel></Button></div>
      </div>
    </div>
  );
}
