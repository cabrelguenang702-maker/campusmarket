import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/cm/feedback";
import { NetworkErrorScreen, NotFoundScreen, ServerErrorScreen } from "@/components/cm/screens";
import { PageHeader } from "@/components/layout/PageHeader";
import { RequestDialog } from "@/components/tutoring/RequestDialog";
import { Stars } from "@/components/tutoring/Stars";
import { BadgeCheck, Clock, MapPin } from "@/components/icons";
import { isNetworkError } from "@/lib/api/errors";
import { MODE_LABEL, useTutor, useTutorReviews } from "@/lib/api/tutoring";
import { useAuth } from "@/lib/auth";
import { formatFcfa } from "@/lib/domain";

export const Route = createFileRoute("/_app/tutorat/$id/")({
  head: () => ({ meta: [{ title: "Tuteur — CampusMarket" }] }),
  component: TutorPage,
});

const dayFmt = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

function TutorPage() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const query = useTutor(id);
  const reviews = useTutorReviews(id);
  const [requesting, setRequesting] = useState(false);

  if (query.isPending) return <div aria-busy className="mx-auto max-w-3xl space-y-3"><div className="h-28 animate-pulse rounded-xl bg-foreground/10" /><div className="h-40 animate-pulse rounded-xl bg-foreground/10" /></div>;
  if (query.isError) return isNetworkError(query.error) ? <NetworkErrorScreen onRetry={() => void query.refetch()} /> : <ServerErrorScreen onRetry={() => void query.refetch()} />;
  const tutor = query.data;
  if (!tutor) return <NotFoundScreen compact />;
  const own = session?.user.id === tutor.userId;
  const sub = [tutor.filiere, tutor.niveau, tutor.university, tutor.campus].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader kicker="Tutorat" title={tutor.name} description={sub || undefined} breadcrumbs={[{ label: "Tutorat", to: "/tutorat" }, { label: tutor.name }]}
        actions={own ? undefined : <Button onClick={() => setRequesting(true)}>Demander une séance</Button>} />

      <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        {tutor.verified && <span className="flex items-center gap-1.5 font-semibold text-primary"><BadgeCheck className="size-4" /> Profil vérifié</span>}
        {tutor.reviewsCount > 0 ? <span className="flex items-center gap-1.5"><Stars value={tutor.rating} /> {tutor.rating.toFixed(1)} ({tutor.reviewsCount} avis)</span> : <span className="text-muted-foreground">Pas encore d'avis</span>}
        <span className="text-muted-foreground">{tutor.sessionsCount} séance{tutor.sessionsCount > 1 ? "s" : ""} donnée{tutor.sessionsCount > 1 ? "s" : ""}</span>
        <span className="font-bold">{tutor.hourlyPrice > 0 ? `${formatFcfa(tutor.hourlyPrice)} / h` : "Gratuit"}</span>
      </div>
      {own && <div className="mb-6"><InlineAlert tone="info">C'est votre profil tel que les autres étudiants le voient. Modifiez-le dans « Mon profil tuteur ».</InlineAlert></div>}

      <section className="space-y-5 rounded-xl border border-border bg-card p-5">
        <div><h2 className="mb-2 font-display text-base font-bold">Matières</h2><div className="flex flex-wrap gap-1.5">{tutor.subjects.map((s) => <span key={s} className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold">{s}</span>)}</div></div>
        {tutor.bio && <div><h2 className="mb-1 font-display text-base font-bold">Présentation</h2><p className="whitespace-pre-line text-sm leading-6">{tutor.bio}</p></div>}
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <p className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" /> {MODE_LABEL[tutor.mode]}</p>
          {tutor.availability && <p className="flex items-center gap-2"><Clock className="size-4 text-muted-foreground" /> {tutor.availability}</p>}
        </div>
      </section>

      <section aria-labelledby="avis" className="mt-8">
        <h2 id="avis" className="mb-3 font-display text-lg font-bold">Avis des étudiants</h2>
        {reviews.isPending ? <div className="h-20 animate-pulse rounded-xl bg-foreground/10" /> : reviews.isError ? <ServerErrorScreen compact onRetry={() => void reviews.refetch()} /> : (reviews.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun avis pour l'instant : ils apparaissent après les premières séances.</p>
        ) : (
          <ul className="space-y-3">
            {reviews.data!.map((r) => (
              <li key={r.requestId} className="rounded-xl border border-border bg-card p-4">
                <p className="flex items-center justify-between gap-2 text-sm"><span className="font-semibold">{r.studentName}</span><span className="text-xs text-muted-foreground">{dayFmt(r.createdAt)}</span></p>
                <Stars value={r.rating} className="text-sm" />
                {r.comment && <p className="mt-1 text-sm">{r.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!own && <RequestDialog tutor={tutor} open={requesting} onOpenChange={setRequesting} />}
    </div>
  );
}
