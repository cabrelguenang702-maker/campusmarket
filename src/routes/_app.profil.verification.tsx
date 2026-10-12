import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, ArrowRight, BadgeCheck, Check, Clock, FileDetail, IdCard, ImageIcon, RefreshCw } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { InlineAlert, LoadingButtonLabel, Spinner, StateScreen } from "@/components/cm/feedback";
import { FileDropzone, SelectableCard, type UploadState } from "@/components/cm/forms";
import { Stepper } from "@/components/cm/stepper";
import { NetworkErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { checkVerificationFile, useLatestVerification, useSubmitVerification, type VerificationDocType } from "@/lib/api/verification";
import { friendlyError, isNetworkError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/profil/verification")({
  head: () => ({ meta: [{ title: "Vérification du compte — CampusMarket" }] }),
  component: VerificationPage,
});

/** Étapes locales du parcours d'envoi. L'état « en cours / vérifié / refusé » vient de la base, pas d'ici. */
type View = "statut" | "choix" | "carte" | "document" | "apercu";
const steps = ["Document", "Envoi", "Aperçu", "Vérification"] as const;
const stepOf: Partial<Record<View, number>> = { choix: 1, carte: 2, document: 2, apercu: 3 };

type Doc = "carte" | "certificat" | "recu";
const docs: { id: Doc; title: string; description: string; recommended?: boolean }[] = [
  { id: "carte", title: "Carte d'étudiant", description: "Recto et verso, en cours de validité", recommended: true },
  { id: "certificat", title: "Certificat de scolarité", description: "Année académique en cours" },
  { id: "recu", title: "Reçu d'inscription", description: "Émis par votre université cette année" },
];

type Picked = { file: File | null; error: string | null; url: string | null };
const none: Picked = { file: null, error: null, url: null };

/** Fichier choisi, conservé localement jusqu'à l'envoi (rien n'est transmis avant « Envoyer pour vérification »). */
function useLocalFile() {
  const [picked, setPicked] = useState<Picked>(none);
  useEffect(() => () => { if (picked.url) URL.revokeObjectURL(picked.url); }, [picked.url]);
  const pick = (file: File) => {
    const error = checkVerificationFile(file);
    setPicked({ file: error ? null : file, error, url: !error && file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
  };
  const state: UploadState = picked.error ? "error" : picked.file ? "done" : "idle";
  return { picked, pick, remove: () => setPicked(none), state };
}
type LocalFile = ReturnType<typeof useLocalFile>;

function Preview({ file, label }: { file: LocalFile; label: string }) {
  return (
    <figure className="overflow-hidden rounded-lg border border-border bg-card">
      {file.picked.url ? <img src={file.picked.url} alt={label} className="h-40 w-full object-cover" /> : <div className="grid h-40 place-items-center bg-gradient-to-br from-primary/15 to-secondary"><ImageIcon className="size-10 text-primary/60" /></div>}
      <figcaption className="flex items-center justify-between gap-2 p-3 text-xs"><span className="font-semibold">{label}</span><span className="truncate text-muted-foreground">{file.picked.file?.name}</span></figcaption>
    </figure>
  );
}

const docLabel: Record<VerificationDocType, string> = { student_card: "Carte d'étudiant", other_document: "Document justificatif" };
const dateFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

function VerificationPage() {
  const { account, session } = useAuth();
  const userId = session?.user.id;
  const profile = account?.profile;
  const latest = useLatestVerification(userId);
  const submit = useSubmitVerification(userId);
  const [view, setView] = useState<View>("statut");
  const [doc, setDoc] = useState<Doc>("carte");
  const [retry, setRetry] = useState(false);
  const front = useLocalFile();
  const back = useLocalFile();
  const single = useLocalFile();

  const usesCard = doc === "carte";
  const ready = usesCard ? !!front.picked.file && !!back.picked.file : !!single.picked.file;
  const step = stepOf[view];
  const request = latest.data ?? null;
  const header = <PageHeader kicker="Mon espace" title="Vérification du compte" description="Obtenez le badge « Étudiant vérifié » et inspirez confiance aux acheteurs et aux vendeurs." breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Mon profil", to: "/profil" }, { label: "Vérification" }]} />;

  const send = () => {
    const files = usesCard ? [front.picked.file, back.picked.file] : [single.picked.file];
    if (files.some((f) => !f)) return;
    submit.mutate({ type: usesCard ? "student_card" : "other_document", files: files as File[] }, {
      onSuccess: () => { toast.success("Documents envoyés", { description: "Vous serez notifié dès la fin de la vérification." }); front.remove(); back.remove(); single.remove(); setRetry(false); setView("statut"); },
      onError: (e) => toast.error("Envoi impossible", { description: e instanceof Error && !("code" in e) ? e.message : friendlyError(e) }),
    });
  };

  if (latest.isPending && !profile?.verified) return <div>{header}<div className="grid place-items-center py-16"><Spinner className="size-6" /></div></div>;
  if (latest.isError && !profile?.verified) return <div>{header}<NetworkErrorScreen compact onRetry={() => void latest.refetch()} />{!isNetworkError(latest.error) && <p className="text-center text-xs text-muted-foreground">{friendlyError(latest.error)}</p>}</div>;

  /* ---- États qui viennent de la base ---- */
  if (profile?.verified) {
    return (
      <div>{header}
        <div className="max-w-xl">
          <div className="dark rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/20 via-card to-card p-6 text-center text-foreground">
            <span className="mx-auto grid size-20 place-items-center rounded-full bg-primary/15 text-primary ring-8 ring-primary/10"><BadgeCheck className="size-11" /></span>
            <h2 className="mt-4 font-display text-2xl font-bold">Étudiant vérifié</h2>
            <p className="mt-1 text-sm text-muted-foreground">{[profile.fullName, profile.campus].filter(Boolean).join(" · ")}</p>
          </div>
          <dl className="mt-5 divide-y divide-border rounded-xl border border-border bg-card text-sm">
            {([["Université", profile.campus], ["Vérifié le", profile.verifiedAt ? dateFr(profile.verifiedAt) : null], ["Document", request?.status === "approved" ? docLabel[request.documentType] : null]] as const).filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>)}
          </dl>
          <Button asChild size="lg" className="mt-6 w-full"><AppLink to="/profil" search={{ vue: "public" }}>Voir mon profil public</AppLink></Button>
        </div>
      </div>
    );
  }

  if (request?.status === "pending") {
    return (
      <div>{header}
        <div className="max-w-xl">
          <StateScreen compact icon={Clock} tone="primary" title="Vérification en cours" description={`Demande envoyée le ${dateFr(request.createdAt)}. Notre équipe examine votre document, en général sous 24 heures. Vous serez notifié dès que c'est terminé.`} className="pt-0"
            actions={<Button asChild variant="outline"><AppLink to="/profil">Retour au profil</AppLink></Button>} />
        </div>
      </div>
    );
  }

  if (request?.status === "rejected" && !retry) {
    return (
      <div>{header}
        <div className="max-w-xl">
          <StateScreen compact icon={AlertCircle} tone="danger" title="Vérification refusée" description="Nous n'avons pas pu valider votre document pour la raison suivante :" className="pb-4 pt-0" />
          <InlineAlert tone="danger" title="Motif du refus">{request.rejectionReason}</InlineAlert>
          <ul className="mt-4 space-y-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">{["Photographiez le document en pleine lumière", "Évitez les reflets et les ombres", "Cadrez le document en entier"].map((t) => <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{t}</li>)}</ul>
          <Button size="lg" className="mt-6 w-full" onClick={() => { setRetry(true); setView("choix"); }}><RefreshCw /> Refaire une vérification</Button>
        </div>
      </div>
    );
  }

  /* ---- Parcours d'envoi ---- */
  return (
    <div>
      {header}
      <div className="max-w-xl">
        {step && <Stepper steps={steps} current={step} className="mb-8" />}

        {view === "statut" && (
          <div>
            <InlineAlert tone="warning" title="Votre compte n'est pas encore vérifié">Ajoutez un justificatif pour prouver que vous êtes étudiant. La vérification prend en général moins de 24 heures.</InlineAlert>
            <ul className="mt-5 space-y-3">
              {[["Un badge visible", "Il apparaît sur votre profil et vos annonces."], ["Plus de confiance", "Les acheteurs préfèrent les vendeurs vérifiés."], ["Des données protégées", "Votre justificatif n'est visible que par l'équipe de vérification, jamais par les autres membres."]].map(([t, d]) => (
                <li key={t} className="flex gap-3 rounded-xl border border-border bg-card p-4"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/12 text-primary"><Check className="size-5" /></span><span><span className="block text-sm font-semibold">{t}</span><span className="block text-xs text-muted-foreground">{d}</span></span></li>
              ))}
            </ul>
            <Button size="lg" className="mt-6 w-full" onClick={() => setView("choix")}>Commencer la vérification <ArrowRight /></Button>
          </div>
        )}

        {view === "choix" && (
          <div>
            <h2 className="font-display text-lg font-bold">Quel document souhaitez-vous envoyer ?</h2>
            <div className="mt-4 space-y-2.5" role="radiogroup" aria-label="Type de document">
              {docs.map((d) => <SelectableCard key={d.id} selected={doc === d.id} onSelect={() => setDoc(d.id)} icon={d.id === "carte" ? IdCard : FileDetail} title={d.title} description={d.description} trailing={d.recommended ? <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-bold text-primary">Recommandé</span> : undefined} />)}
            </div>
            <div className="mt-6 grid grid-cols-[auto_1fr] gap-2.5"><Button size="lg" variant="outline" onClick={() => setView("statut")}><ArrowLeft /> Retour</Button><Button size="lg" onClick={() => setView(usesCard ? "carte" : "document")}>Continuer <ArrowRight /></Button></div>
          </div>
        )}

        {view === "carte" && (
          <div>
            <h2 className="font-display text-lg font-bold">Envoyez votre carte d'étudiant</h2>
            <p className="mt-1 text-sm text-muted-foreground">Photographiez les deux faces sur une surface plane, sans reflet.</p>
            <div className="mt-4 space-y-3">
              <FileDropzone label="Recto de la carte" hint="JPG ou PNG — 5 Mo maximum" state={front.state} fileName={front.picked.file?.name} progress={100} errorText={front.picked.error ?? "Fichier refusé."} onPick={front.pick} onRemove={front.remove} />
              <FileDropzone label="Verso de la carte" hint="JPG ou PNG — 5 Mo maximum" state={back.state} fileName={back.picked.file?.name} progress={100} errorText={back.picked.error ?? "Fichier refusé."} onPick={back.pick} onRemove={back.remove} />
            </div>
            <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">{["Le texte doit être lisible", "La carte doit être en cours de validité", "Toutes les bordures sont visibles"].map((t) => <li key={t} className="flex items-center gap-2"><Check className="size-3.5 text-success" />{t}</li>)}</ul>
            <div className="mt-6 grid grid-cols-[auto_1fr] gap-2.5"><Button size="lg" variant="outline" onClick={() => setView("choix")}><ArrowLeft /> Retour</Button><Button size="lg" disabled={!ready} onClick={() => setView("apercu")}>Voir l'aperçu <ArrowRight /></Button></div>
          </div>
        )}

        {view === "document" && (
          <div>
            <h2 className="font-display text-lg font-bold">Envoyez votre {docs.find((d) => d.id === doc && d.id !== "carte")?.title.toLowerCase() ?? "document"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Le document doit porter votre nom et le nom de votre établissement.</p>
            <div className="mt-4"><FileDropzone kind="file" label="Ajouter le document" hint="PDF, JPG ou PNG — 5 Mo maximum" state={single.state} fileName={single.picked.file?.name} progress={100} errorText={single.picked.error ?? "Fichier refusé."} onPick={single.pick} onRemove={single.remove} /></div>
            <div className="mt-6 grid grid-cols-[auto_1fr] gap-2.5"><Button size="lg" variant="outline" onClick={() => setView("choix")}><ArrowLeft /> Retour</Button><Button size="lg" disabled={!ready} onClick={() => setView("apercu")}>Voir l'aperçu <ArrowRight /></Button></div>
          </div>
        )}

        {view === "apercu" && (
          <div>
            <h2 className="font-display text-lg font-bold">Vérifiez vos documents</h2>
            <p className="mt-1 text-sm text-muted-foreground">Assurez-vous que tout est lisible avant l'envoi.</p>
            <div className={cn("mt-4 grid gap-3", usesCard && "sm:grid-cols-2")}>{usesCard ? <><Preview file={front} label="Recto" /><Preview file={back} label="Verso" /></> : <Preview file={single} label="Document" />}</div>
            <InlineAlert tone="info" className="mt-4">Vos documents sont stockés dans un espace privé, accessible uniquement à l'équipe de vérification.</InlineAlert>
            <div className="mt-6 grid grid-cols-[auto_1fr] gap-2.5"><Button size="lg" variant="outline" disabled={submit.isPending} onClick={() => setView(usesCard ? "carte" : "document")}><ArrowLeft /> Modifier</Button><Button size="lg" disabled={submit.isPending || !ready} onClick={send}><LoadingButtonLabel loading={submit.isPending} loadingText="Envoi…">Envoyer pour vérification</LoadingButtonLabel></Button></div>
          </div>
        )}
      </div>
    </div>
  );
}
