import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle, Download, Fullscreen, Lock, Printer, Search } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { StateScreen } from "@/components/cm/feedback";
import { SelectableCard } from "@/components/cm/forms";
import { NetworkErrorScreen, ServerErrorScreen } from "@/components/cm/screens";
import { ProgressBar } from "@/components/academy/CourseCard";
import { CertificatePaper, downloadCertificatePng, type CertificateData } from "@/components/academy/Certificate";
import { PageHeader } from "@/components/layout/PageHeader";
import { certificateNumber, courseProgress, nextModule } from "@/lib/academy-model";
import { useCertificate, useCourse, useLearner } from "@/lib/api/academy";
import { isNetworkError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app/formations/$id/certificat")({
  head: () => ({ meta: [{ title: "Certificat — Campus Academy" }] }),
  component: CertificatePage,
});

type Format = "pdf" | "png";

function CertificatePage() {
  const { id } = Route.useParams();
  const { session, account } = useAuth();
  const userId = session?.user.id;
  const courseQuery = useCourse(id);
  const course = courseQuery.data;
  const certQuery = useCertificate(userId, id);
  const learner = useLearner(userId).data;
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dlOpen, setDlOpen] = useState(false);
  const [format, setFormat] = useState<Format>("pdf");
  const [busy, setBusy] = useState(false);

  const crumbs = [{ label: "Accueil", to: "/" }, { label: "Formations", to: "/formations" }, { label: course?.title ?? "Formation", to: course ? `/formations/${course.id}` : "/formations" }, { label: "Certificat" }];
  const header = <PageHeader kicker="Campus Academy" title="Mon certificat" breadcrumbs={crumbs} />;

  if (courseQuery.isPending || certQuery.isPending) return <div>{header}<div className="max-w-4xl animate-pulse rounded-md bg-foreground/10" style={{ aspectRatio: "1000 / 707" }} aria-busy /></div>;
  const failed = courseQuery.isError ? courseQuery : certQuery.isError ? certQuery : null;
  if (failed) return <div>{header}{isNetworkError(failed.error) ? <NetworkErrorScreen compact onRetry={() => void failed.refetch()} /> : <ServerErrorScreen compact onRetry={() => void failed.refetch()} />}</div>;
  if (!course) return <div>{header}<StateScreen icon={Search} title="Certificat introuvable" description="Aucune formation ne correspond à ce certificat." actions={<Button asChild size="lg"><AppLink to="/formations">Voir le catalogue</AppLink></Button>} /></div>;

  const cert = certQuery.data;
  if (!cert) {
    const completed = learner?.completed ?? new Set<string>();
    const p = courseProgress(course, completed);
    const next = nextModule(course, completed);
    return (
      <div>
        {header}
        <div className="mx-auto max-w-md rounded-xl border border-border bg-card">
          <StateScreen icon={Lock} tone="warning" title="Certificat pas encore disponible" description="Terminez tous les modules de la formation pour obtenir votre certificat de réussite."
            actions={<div className="w-full space-y-3"><div><div className="mb-1.5 flex justify-between text-xs"><span className="font-semibold">Progression</span><span className="font-bold text-primary">{p.pct} %</span></div><ProgressBar pct={p.pct} className="h-3" /><p className="mt-1.5 text-left text-xs text-muted-foreground">{p.done}/{p.total} modules terminés</p></div><Button asChild size="lg" className="w-full"><AppLink to={next ? `/formations/${course.id}/modules/${next.id}` : `/formations/${course.id}`}>Continuer la formation</AppLink></Button></div>} />
        </div>
      </div>
    );
  }

  const holder = account?.profile.fullName ?? "";
  const data: CertificateData = { name: holder, course, date: new Date(cert.issuedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }), id: certificateNumber(cert.code) };

  const startDownload = async () => {
    if (format === "pdf") {
      setDlOpen(false);
      toast.info("Choisissez « Enregistrer au format PDF »", { description: "Dans la fenêtre d'impression de votre navigateur." });
      setTimeout(() => window.print(), 250);
      return;
    }
    setBusy(true);
    try { await downloadCertificatePng(data); toast.success("Certificat téléchargé"); setDlOpen(false); }
    catch { toast.error("Téléchargement impossible"); }
    finally { setBusy(false); }
  };

  return (
    <div>
      {header}
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="print-area min-w-0"><CertificatePaper data={data} /></div>
        <aside className="space-y-4">
          <section className="rounded-xl border border-success/30 bg-success/5 p-5">
            <span className="grid size-12 place-items-center rounded-full bg-success/15 text-success"><CheckCircle className="size-7" /></span>
            <h2 className="mt-3 font-display text-lg font-bold">Félicitations{holder ? `, ${holder.split(" ")[0]}` : ""} !</h2>
            <p className="mt-1 text-sm text-muted-foreground">Vous avez terminé « {course.title} ». Conservez le numéro de votre certificat : il identifie votre réussite.</p>
          </section>
          <section className="space-y-2.5 rounded-xl border border-border bg-card p-4">
            <Button size="lg" className="w-full" onClick={() => setDlOpen(true)}><Download /> Télécharger</Button>
            <Button size="lg" variant="outline" className="w-full" onClick={() => window.print()}><Printer /> Imprimer</Button>
            <Button size="lg" variant="outline" className="w-full" onClick={() => setPreviewOpen(true)}><Fullscreen /> Aperçu en grand</Button>
          </section>
          <dl className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
            {[["N° du certificat", data.id], ["Délivré le", data.date], ["Formation", course.title]].map(([k, v]) => <div key={k} className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>)}
          </dl>
        </aside>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-5xl gap-3 p-3 sm:p-5">
          <DialogHeader><DialogTitle className="font-display">Aperçu du certificat</DialogTitle><DialogDescription>Vérifiez votre nom et les informations avant de télécharger.</DialogDescription></DialogHeader>
          <CertificatePaper data={data} />
          <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setPreviewOpen(false)}>Fermer</Button><Button onClick={() => { setPreviewOpen(false); setDlOpen(true); }}><Download /> Télécharger</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={dlOpen} onOpenChange={(o) => { if (!busy) setDlOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display">Télécharger le certificat</DialogTitle><DialogDescription>Choisissez le format du fichier.</DialogDescription></DialogHeader>
          <div className="space-y-2.5" role="radiogroup" aria-label="Format">
            <SelectableCard selected={format === "pdf"} onSelect={() => setFormat("pdf")} icon={Printer} title="PDF / impression" description="Ouvre l'impression : choisissez « Enregistrer en PDF »" />
            <SelectableCard selected={format === "png"} onSelect={() => setFormat("png")} icon={Download} title="Image PNG" description="Haute définition, idéale pour le partage" />
          </div>
          <Button size="lg" className="w-full" disabled={busy} onClick={() => void startDownload()}>{busy ? "Préparation…" : format === "pdf" ? "Imprimer / enregistrer en PDF" : "Télécharger l'image"}</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
