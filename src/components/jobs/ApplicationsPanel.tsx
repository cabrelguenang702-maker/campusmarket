import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/cm/badges";
import { InlineAlert } from "@/components/cm/feedback";
import { formatDate } from "@/lib/domain";
import { friendlyError } from "@/lib/api/errors";
import { APPLICATION_STATUS_LABEL, cvUrl, useOfferApplications, useSetApplicationStatus, type ApplicationStatus, type OfferApplication, type ProItem } from "@/lib/api/jobs";

type Decision = Exclude<ApplicationStatus, "received" | "withdrawn">;
const ACTIONS: { status: Decision; label: string }[] = [
  { status: "reviewing", label: "En examen" }, { status: "shortlisted", label: "Présélectionner" }, { status: "interview", label: "Entretien" },
  { status: "accepted", label: "Accepter" }, { status: "rejected", label: "Refuser" },
];

function Card({ a, offerId }: { a: OfferApplication; offerId: string }) {
  const [note, setNote] = useState(a.note);
  const set = useSetApplicationStatus(offerId);
  const s = a.snapshot;
  const sections: [string, ProItem[] | undefined][] = [["Formation", s?.education], ["Expériences", s?.experiences], ["Projets", s?.projects]];
  const final = a.status === "accepted" || a.status === "rejected" || a.status === "withdrawn";
  const openCv = async () => { try { window.open(await cvUrl(a.cvPath!), "_blank", "noopener"); } catch (e) { toast.error(friendlyError(e)); } };
  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="font-semibold">{a.applicantName}</p><p className="text-xs text-muted-foreground">Reçue le {formatDate(a.createdAt)}{s?.campus ? ` · ${s.campus}` : ""}</p></div>
        <Pill tone={a.status === "accepted" ? "success" : a.status === "rejected" ? "danger" : "primary"}>{APPLICATION_STATUS_LABEL[a.status]}</Pill>
      </div>
      {s?.headline && <p className="mt-2 text-sm font-medium">{s.headline}</p>}
      {s?.summary && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{s.summary}</p>}
      {s?.skills && s.skills.length > 0 && <p className="mt-1 text-xs">{s.skills.join(" · ")}</p>}
      {sections.map(([l, items]) => (items?.length ? (
        <div key={l} className="mt-2 text-xs"><p className="font-semibold">{l}</p><ul className="list-disc pl-4 text-muted-foreground">{items.map((i, k) => <li key={k}>{i.title}{i.place ? `, ${i.place}` : ""}{i.period ? ` (${i.period})` : ""}</li>)}</ul></div>
      ) : null))}
      {s?.portfolio_url && <p className="mt-2 text-xs"><a href={s.portfolio_url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold underline">Portfolio</a></p>}
      {a.message && <p className="mt-3 whitespace-pre-line rounded-lg bg-secondary p-3 text-sm">{a.message}</p>}
      {a.answers.filter(Boolean).map((r, i) => <p key={i} className="mt-2 whitespace-pre-line text-sm"><span className="text-xs text-muted-foreground">Réponse {i + 1} :</span> {r}</p>)}
      {a.cvPath && <Button variant="outline" size="sm" className="mt-3" onClick={() => void openCv()}>Ouvrir le CV (PDF)</Button>}
      {!final && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <Textarea aria-label="Note interne (invisible du candidat)" placeholder="Note interne, invisible du candidat" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {ACTIONS.filter((x) => x.status !== a.status).map((x) => (
              <Button key={x.status} size="sm" variant={x.status === "rejected" ? "outline" : "secondary"} disabled={set.isPending} onClick={() => set.mutate({ id: a.id, status: x.status, note })}>{x.label}</Button>
            ))}
          </div>
          {set.isError && <InlineAlert tone="danger">{friendlyError(set.error, "Impossible de mettre à jour la candidature.")}</InlineAlert>}
        </div>
      )}
    </li>
  );
}

export function ApplicationsPanel({ offerId }: { offerId: string }) {
  const query = useOfferApplications(offerId);
  if (query.isLoading) return <div aria-busy className="h-24 animate-pulse rounded-xl bg-foreground/10" />;
  if (query.isError) return <InlineAlert tone="danger">Impossible de charger les candidatures.</InlineAlert>;
  if (!query.data?.length) return <p className="text-sm text-muted-foreground">Aucune candidature pour le moment.</p>;
  return <ul className="space-y-3">{query.data.map((a) => <Card key={a.id} a={a} offerId={offerId} />)}</ul>;
}
