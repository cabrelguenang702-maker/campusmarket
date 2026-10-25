import { Pill } from "@/components/cm/badges";
import { BadgeCheck, MapPin } from "@/components/icons";
import { Link } from "@tanstack/react-router";
import { KIND_LABEL, MODE_LABEL, LEVEL_LABEL, type JobOffer } from "@/lib/api/jobs";
import { formatDate } from "@/lib/domain";

export function JobMeta({ o }: { o: Pick<JobOffer, "kind" | "workMode" | "level" | "city" | "countryCode"> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Pill tone="primary">{KIND_LABEL[o.kind]}</Pill>
      <Pill>{MODE_LABEL[o.workMode]}</Pill>
      <Pill>{LEVEL_LABEL[o.level]}</Pill>
      {(o.city || o.countryCode) && <Pill icon={MapPin}>{[o.city, o.countryCode].filter(Boolean).join(", ")}</Pill>}
    </div>
  );
}

export function JobCard({ o }: { o: JobOffer }) {
  return (
    <Link to="/emplois/$id" params={{ id: o.id }} className="block rounded-xl border bg-card p-4 transition hover:border-primary/50 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-base font-bold">{o.title}</h3>
          <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
            {o.organization}{o.verified && <BadgeCheck className="size-4 text-primary" aria-label="Organisation vérifiée" />}
          </p>
        </div>
        {o.hasApplied && <Pill tone="success">Déjà postulé</Pill>}
      </div>
      <div className="mt-3"><JobMeta o={o} /></div>
      {o.skills.length > 0 && <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">{o.skills.join(" · ")}</p>}
      <p className="mt-2 text-xs text-muted-foreground">{o.deadline ? `Date limite : ${formatDate(o.deadline)}` : "Sans date limite"}{o.compensation ? ` · ${o.compensation}` : ""}</p>
    </Link>
  );
}

export function JobsTabs({ active }: { active: "offres" | "candidatures" | "profil" | "recruteur" }) {
  const tabs = [
    { id: "offres", label: "Offres", to: "/emplois" },
    { id: "candidatures", label: "Mes candidatures", to: "/emplois/candidatures" },
    { id: "profil", label: "Profil professionnel", to: "/emplois/profil" },
    { id: "recruteur", label: "Espace recruteur", to: "/emplois/recruteur" },
  ] as const;
  return (
    <nav aria-label="Campus Jobs" className="mb-5 flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => (
        <Link key={t.id} to={t.to} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${t.id === active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t.label}</Link>
      ))}
    </nav>
  );
}
