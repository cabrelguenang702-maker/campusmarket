import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Flag, MoreHorizontal, Pin, Send, Trash } from "@/components/icons";
import { Avatar } from "@/components/cm/commerce";
import { ConfirmDialog, Spinner } from "@/components/cm/feedback";
import { Pill } from "@/components/cm/badges";
import { AppLink } from "@/components/cm/app-link";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/api/errors";
import { submitReport } from "@/lib/api/engagement";
import { useCommentActions, useComments, usePostActions, type FeedPost } from "@/lib/api/spaces";
import { useAuth } from "@/lib/auth";
import { timeAgo } from "@/lib/domain";
import { reactionKinds, reactionMeta, type ReactionKind } from "@/lib/spaces-model";

function ReactionSummary({ counts }: { counts: FeedPost["reactions"] }) {
  const entries = reactionKinds.map((k) => ({ k, n: counts[k] ?? 0 })).filter((e) => e.n > 0);
  const total = entries.reduce((n, e) => n + e.n, 0);
  if (total === 0) return <span />;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="flex -space-x-1">{entries.slice(0, 3).map(({ k }) => { const Icon = reactionMeta[k].icon; return <span key={k} className={cn("grid size-4 place-items-center rounded-full bg-card ring-1 ring-card", reactionMeta[k].className)}><Icon className="size-3" /></span>; })}</span>
      {total}
    </span>
  );
}

function Comments({ post, canModerate }: { post: FeedPost; canModerate: boolean }) {
  const { session, account } = useAuth();
  const userId = session?.user.id;
  const query = useComments(post.id, true);
  const actions = useCommentActions(post.id, post.spaceId, userId);
  const [text, setText] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    actions.add.mutate(t, { onSuccess: () => setText(""), onError: (err) => toast.error("Commentaire non envoyé", { description: friendlyError(err) }) });
  };
  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      {query.isPending ? <div className="grid place-items-center py-2"><Spinner className="size-4" /></div>
        : query.isError ? <p className="text-xs text-muted-foreground">Impossible de charger les commentaires. <button className="font-semibold text-primary hover:underline" onClick={() => void query.refetch()}>Réessayer</button></p>
        : (query.data ?? []).length > 0 && (
          <ul className="space-y-3">{(query.data ?? []).map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Avatar name={c.authorName} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="w-fit max-w-full rounded-2xl rounded-tl-md bg-secondary px-3.5 py-2"><p className="text-xs font-semibold">{c.authorName}</p><p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-5">{c.text}</p></div>
                <p className="mt-1 flex items-center gap-3 px-1 text-[11px] text-muted-foreground">{timeAgo(c.createdAt)}{(c.authorId === userId || canModerate) && <button className="font-semibold hover:text-destructive" onClick={() => actions.remove.mutate(c.id, { onError: (err) => toast.error("Suppression impossible", { description: friendlyError(err) }) })}>Supprimer</button>}</p>
              </div>
            </li>
          ))}</ul>
        )}
      <form onSubmit={submit} className="flex items-center gap-2">
        <Avatar name={account?.profile.fullName ?? ""} size="sm" src={account?.profile.avatarUrl} />
        <input value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Écrire un commentaire…" aria-label="Écrire un commentaire" className="h-9 flex-1 rounded-full border border-input bg-card px-3.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25" />
        <Button type="submit" size="icon" className="size-9 shrink-0" aria-label="Envoyer le commentaire" disabled={!text.trim() || actions.add.isPending}><Send className="size-4" /></Button>
      </form>
    </div>
  );
}

/** Publication du fil : auteur, texte, image, réactions, commentaires et actions de modération. */
export function PostCard({ post, canModerate }: { post: FeedPost; canModerate: boolean }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const actions = usePostActions(post.spaceId, userId);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isMine = post.authorId === userId;
  const current = post.myReaction;
  const CurrentIcon = current ? reactionMeta[current].icon : reactionMeta.jaime.icon;
  const fail = (title: string) => (e: unknown) => toast.error(title, { description: friendlyError(e) });

  const report = async () => {
    if (!userId) return;
    try { await submitReport({ reporterId: userId, targetType: "post", targetId: post.id, reason: "Contenu inapproprié", details: "" }); toast.info("Signalement envoyé", { description: "Notre équipe va examiner cette publication." }); }
    catch (e) { toast.error("Signalement impossible", { description: friendlyError(e) }); }
  };

  return (
    <article className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <AppLink to={`/boutique/${post.authorId}`}><Avatar name={post.authorName} size="md" src={post.authorAvatar} /></AppLink>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5"><AppLink to={`/boutique/${post.authorId}`} className="truncate text-sm font-semibold hover:text-primary">{post.authorName}</AppLink>{post.pinned && <Pill tone="primary" icon={Pin}>Épinglé</Pill>}</div>
          <p className="text-xs text-muted-foreground">{timeAgo(post.createdAt)}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="-mr-2 -mt-1 size-8 shrink-0" aria-label="Actions de la publication"><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canModerate && <DropdownMenuItem className="cursor-pointer" onClick={() => actions.pin.mutate({ id: post.id, pinned: !post.pinned }, { onSuccess: () => toast.success(post.pinned ? "Publication désépinglée" : "Publication épinglée"), onError: fail("Action impossible") })}><Pin /> {post.pinned ? "Désépingler" : "Épingler"}</DropdownMenuItem>}
            {(canModerate || isMine) && <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={() => setConfirmDelete(true)}><Trash /> Supprimer</DropdownMenuItem>}
            {!isMine && <DropdownMenuItem className="cursor-pointer" onClick={() => void report()}><Flag /> Signaler</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{post.text}</p>
      {post.imageUrl && <img src={post.imageUrl} alt="Image de la publication" loading="lazy" className="mt-3 max-h-[28rem] w-full rounded-lg bg-muted object-cover" />}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <ReactionSummary counts={post.reactions} />
        <button onClick={() => setCommentsOpen((o) => !o)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">{post.commentCount} commentaire{post.commentCount > 1 ? "s" : ""}</button>
      </div>

      <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
        <Popover>
          <PopoverTrigger asChild><Button variant="ghost" size="sm" className={cn("gap-1.5", current && reactionMeta[current].className)}><CurrentIcon className="size-[18px]" />{current ? reactionMeta[current].label : "J'aime"}</Button></PopoverTrigger>
          <PopoverContent align="start" className="flex w-auto gap-1 p-1.5">
            {reactionKinds.map((k: ReactionKind) => { const Icon = reactionMeta[k].icon; return <button key={k} aria-label={reactionMeta[k].label} onClick={() => actions.react.mutate({ postId: post.id, kind: k, current }, { onError: fail("Réaction impossible") })} className={cn("grid size-9 place-items-center rounded-full transition hover:scale-110 hover:bg-accent", reactionMeta[k].className)}><Icon className="size-5" /></button>; })}
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="sm" onClick={() => setCommentsOpen((o) => !o)}><Send /> Commenter</Button>
      </div>

      {commentsOpen && <Comments post={post} canModerate={canModerate} />}

      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} destructive title="Supprimer cette publication ?" description="Cette action est définitive et ne peut pas être annulée." confirmLabel="Supprimer"
        onConfirm={() => actions.remove.mutate({ id: post.id, imagePath: post.imagePath }, { onSuccess: () => toast("Publication supprimée"), onError: fail("Suppression impossible") })} />
    </article>
  );
}
