import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { UserFacingError } from "./errors";

/* Campus Jobs : offres, candidatures, espace recruteur, profil professionnel.
 * Les changements d'état (soumission, modération, candidature, décision) passent par des fonctions de la base (migration 0058) :
 * les messages d'erreur ci-dessous traduisent leurs codes. */

export type JobKind = "stage" | "emploi" | "mission" | "benevolat" | "mentorat";
export type JobLevel = "debutant" | "intermediaire" | "confirme" | "tous";
export type WorkMode = "sur_site" | "distant" | "hybride";
export type OfferStatus = "draft" | "pending_review" | "published" | "rejected" | "closed" | "archived" | "suspended";
export type RecruiterStatus = "pending" | "verified" | "rejected" | "suspended";
export type ApplicationStatus = "received" | "reviewing" | "shortlisted" | "interview" | "accepted" | "rejected" | "withdrawn";

export const KIND_LABEL: Record<JobKind, string> = { stage: "Stage", emploi: "Emploi", mission: "Mission freelance", benevolat: "Bénévolat", mentorat: "Mentorat" };
export const LEVEL_LABEL: Record<JobLevel, string> = { debutant: "Débutant", intermediaire: "Intermédiaire", confirme: "Confirmé", tous: "Tous niveaux" };
export const MODE_LABEL: Record<WorkMode, string> = { sur_site: "Sur site", distant: "À distance", hybride: "Hybride" };
export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = { draft: "Brouillon", pending_review: "En vérification", published: "Publiée", rejected: "Refusée", closed: "Clôturée", archived: "Archivée", suspended: "Suspendue" };
export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = { received: "Reçue", reviewing: "En cours d'examen", shortlisted: "Présélectionnée", interview: "Entretien", accepted: "Acceptée", rejected: "Non retenue", withdrawn: "Retirée" };
export const RECRUITER_STATUS_LABEL: Record<RecruiterStatus, string> = { pending: "En attente de vérification", verified: "Organisation vérifiée", rejected: "Refusée", suspended: "Suspendue" };

const ERRORS: Record<string, string> = {
  forbidden: "Action non autorisée avec votre compte.",
  not_found: "Élément introuvable.",
  invalid_organization: "Le nom de l'organisation doit faire entre 2 et 150 caractères.",
  invalid_website: "Le site web doit commencer par http:// ou https://.",
  invalid_description: "La description est trop longue (2 000 caractères maximum).",
  suspended: "Votre espace recruteur est suspendu. Contactez le support.",
  already_verified: "Votre organisation est déjà vérifiée.",
  not_submittable: "Cette offre ne peut plus être soumise dans son état actuel.",
  recruiter_not_allowed: "Votre espace recruteur n'est pas actif.",
  location_required: "Indiquez le pays de l'offre, sauf si elle est entièrement à distance.",
  deadline_passed: "La date limite est dépassée.",
  too_many_offers: "Vous avez atteint le maximum de 30 offres actives ou en vérification.",
  duplicate: "Une offre avec le même titre est déjà publiée ou en vérification.",
  invalid_transition: "Ce changement d'état n'est pas possible.",
  invalid_decision: "Décision invalide.",
  invalid_status: "Statut invalide.",
  reason_required: "Indiquez un motif (3 caractères minimum).",
  offer_unavailable: "Cette offre n'est plus disponible.",
  own_offer: "Vous ne pouvez pas postuler à votre propre offre.",
  already_applied: "Vous avez déjà postulé à cette offre.",
  message_too_long: "Le message est trop long (3 000 caractères maximum).",
  invalid_answers: "Une réponse aux questions est invalide ou trop longue.",
  invalid_cv: "Le CV doit être un fichier que vous avez déposé vous-même.",
  rate_limited: "Vous avez atteint la limite de 20 candidatures par jour. Réessayez demain.",
  not_withdrawable: "Cette candidature ne peut plus être retirée.",
  withdrawn: "Le candidat a retiré sa candidature.",
  already_decided: "Une décision définitive a déjà été prise sur cette candidature.",
  same_status: "La candidature est déjà dans cet état.",
  note_too_long: "La note est trop longue (2 000 caractères maximum).",
  cannot_review_own: "Vous ne pouvez pas vérifier votre propre organisation.",
};

type RpcResult = { success?: boolean; error?: string; status?: string; application_id?: string };
async function rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const { data, error } = await requireSupabase().rpc(fn, args);
  if (error) throw error;
  const r = (data ?? {}) as RpcResult;
  if (!r.success) throw new UserFacingError(ERRORS[r.error ?? ""] ?? "L'action n'a pas pu aboutir.");
  return r;
}

/* ---------- Offres (lecture) ---------- */
export type JobOffer = {
  id: string; recruiterId: string; kind: JobKind; title: string; description: string; responsibilities: string | null; skills: string[];
  level: JobLevel; domain: string | null; countryCode: string | null; city: string | null; workMode: WorkMode; compensation: string | null;
  deadline: string | null; questions: string[]; status: OfferStatus; statusReason: string | null; publishedAt: string | null; createdAt: string;
  organization: string; website: string | null; organizationDescription: string | null; verified: boolean; hasApplied: boolean;
};
type FeedRow = {
  id: string; recruiter_id: string; kind: JobKind; title: string; description: string; responsibilities: string | null; skills: string[]; level: JobLevel;
  domain: string | null; country_code: string | null; city: string | null; work_mode: WorkMode; compensation: string | null; deadline: string | null;
  questions: string[]; status: OfferStatus; status_reason: string | null; published_at: string | null; created_at: string;
  organization_name: string; organization_website: string | null; organization_description: string | null; organization_verified: boolean; has_applied: boolean;
};
const mapOffer = (r: FeedRow): JobOffer => ({
  id: r.id, recruiterId: r.recruiter_id, kind: r.kind, title: r.title, description: r.description, responsibilities: r.responsibilities, skills: r.skills, level: r.level,
  domain: r.domain, countryCode: r.country_code?.trim() ?? null, city: r.city, workMode: r.work_mode, compensation: r.compensation, deadline: r.deadline, questions: r.questions,
  status: r.status, statusReason: r.status_reason, publishedAt: r.published_at, createdAt: r.created_at, organization: r.organization_name, website: r.organization_website,
  organizationDescription: r.organization_description, verified: r.organization_verified, hasApplied: r.has_applied,
});

export type OfferFilters = { q?: string | undefined; kind?: JobKind | undefined; country?: string | undefined; mode?: WorkMode | undefined; level?: JobLevel | undefined };

export function useJobOffers(f: OfferFilters) {
  return useQuery({
    queryKey: ["jobs", "feed", f],
    enabled: getSupabase() !== null,
    queryFn: async () => {
      let q = requireSupabase().from("job_offers_feed").select("*").eq("status", "published").order("published_at", { ascending: false }).limit(100);
      if (f.kind) q = q.eq("kind", f.kind);
      if (f.country) q = q.eq("country_code", f.country);
      if (f.mode) q = q.eq("work_mode", f.mode);
      if (f.level) q = q.in("level", [f.level, "tous"]);
      const term = f.q?.trim().replace(/[%_,()]/g, " ").trim();
      if (term && term.length >= 2) q = q.or(`title.ilike.%${term}%,organization_name.ilike.%${term}%,domain.ilike.%${term}%`);
      const { data, error } = await q;
      if (error) throw error;
      const today = new Date().toISOString().slice(0, 10);
      return ((data ?? []) as FeedRow[]).map(mapOffer).filter((o) => !o.deadline || o.deadline >= today);
    },
  });
}

export function useJobOffer(id: string) {
  return useQuery({
    queryKey: ["jobs", "offer", id],
    enabled: getSupabase() !== null,
    queryFn: async () => {
      const { data, error } = await requireSupabase().from("job_offers_feed").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? mapOffer(data as FeedRow) : null;
    },
  });
}

/* ---------- Profil professionnel ---------- */
export type ProProfile = { headline: string; summary: string; skills: string[]; education: ProItem[]; experiences: ProItem[]; projects: ProItem[]; portfolioUrl: string };
export type ProItem = { title: string; place?: string; period?: string; description?: string };
export const emptyProfile: ProProfile = { headline: "", summary: "", skills: [], education: [], experiences: [], projects: [], portfolioUrl: "" };

export function useProProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ["jobs", "profile", userId],
    enabled: getSupabase() !== null && !!userId,
    queryFn: async (): Promise<ProProfile> => {
      const { data, error } = await requireSupabase().from("professional_profiles").select("*").eq("user_id", userId!).maybeSingle();
      if (error) throw error;
      if (!data) return emptyProfile;
      const r = data as { headline: string | null; summary: string | null; skills: string[]; education: ProItem[]; experiences: ProItem[]; projects: ProItem[]; portfolio_url: string | null };
      return { headline: r.headline ?? "", summary: r.summary ?? "", skills: r.skills, education: r.education, experiences: r.experiences, projects: r.projects, portfolioUrl: r.portfolio_url ?? "" };
    },
  });
}

export function useSaveProProfile(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: ProProfile) => {
      const clean = (items: ProItem[]) => items.filter((i) => i.title.trim()).slice(0, 10).map((i) => ({ ...i, title: i.title.trim() }));
      const { error } = await requireSupabase().from("professional_profiles").upsert({
        user_id: userId!, headline: p.headline.trim() || null, summary: p.summary.trim() || null,
        skills: p.skills.map((s) => s.trim()).filter(Boolean).slice(0, 20), education: clean(p.education), experiences: clean(p.experiences), projects: clean(p.projects),
        portfolio_url: p.portfolioUrl.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs", "profile", userId] }),
  });
}

/* ---------- Candidatures (côté candidat) ---------- */
export type MyApplication = { id: string; offerId: string; status: ApplicationStatus; createdAt: string; title: string; organization: string; events: { status: ApplicationStatus; at: string }[] };

export function useMyApplications(userId: string | undefined) {
  return useQuery({
    queryKey: ["jobs", "my-applications", userId],
    enabled: getSupabase() !== null && !!userId,
    queryFn: async (): Promise<MyApplication[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from("job_applications").select("id, offer_id, status, created_at").eq("applicant_id", userId!).order("created_at", { ascending: false });
      if (error) throw error;
      const apps = (data ?? []) as { id: string; offer_id: string; status: ApplicationStatus; created_at: string }[];
      if (apps.length === 0) return [];
      const [offers, events] = await Promise.all([
        sb.from("job_offers_feed").select("id, title, organization_name").in("id", apps.map((a) => a.offer_id)),
        sb.from("job_application_events").select("application_id, status, created_at").in("application_id", apps.map((a) => a.id)).order("created_at"),
      ]);
      if (offers.error) throw offers.error;
      if (events.error) throw events.error;
      const byOffer = new Map(((offers.data ?? []) as { id: string; title: string; organization_name: string }[]).map((o) => [o.id, o]));
      const evs = (events.data ?? []) as { application_id: string; status: ApplicationStatus; created_at: string }[];
      return apps.map((a) => ({
        id: a.id, offerId: a.offer_id, status: a.status, createdAt: a.created_at,
        title: byOffer.get(a.offer_id)?.title ?? "Offre retirée", organization: byOffer.get(a.offer_id)?.organization_name ?? "",
        events: evs.filter((e) => e.application_id === a.id).map((e) => ({ status: e.status, at: e.created_at })),
      }));
    },
  });
}

/** Dépose un CV PDF (5 Mo max) dans le dossier privé de l'utilisateur et renvoie son chemin. */
export async function uploadCv(userId: string, file: File): Promise<string> {
  if (file.type !== "application/pdf") throw new UserFacingError("Le CV doit être un fichier PDF.");
  if (file.size > 5 * 1024 * 1024) throw new UserFacingError("Le CV ne doit pas dépasser 5 Mo.");
  const path = `${userId}/${Date.now()}-cv.pdf`;
  const { error } = await requireSupabase().storage.from("job-documents").upload(path, file, { contentType: "application/pdf" });
  if (error) throw error;
  return path;
}

export async function cvUrl(path: string): Promise<string> {
  const { data, error } = await requireSupabase().storage.from("job-documents").createSignedUrl(path, 600);
  if (error || !data) throw new UserFacingError("Impossible d'ouvrir ce CV.");
  return data.signedUrl;
}

export function useApply(offerId: string, userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { message: string; answers: string[]; cv: File | null; shareProfile: boolean }) => {
      const cvPath = v.cv ? await uploadCv(userId!, v.cv) : null;
      await rpc("apply_to_job", { p_offer_id: offerId, p_message: v.message, p_answers: v.answers, p_cv_path: cvPath, p_share_profile: v.shareProfile });
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["jobs", "offer", offerId] }), qc.invalidateQueries({ queryKey: ["jobs", "my-applications"] }), qc.invalidateQueries({ queryKey: ["jobs", "feed"] })]),
  });
}

export function useWithdraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (applicationId: string) => rpc("withdraw_job_application", { p_application_id: applicationId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs", "my-applications"] }),
  });
}

/* ---------- Espace recruteur ---------- */
export type Recruiter = { status: RecruiterStatus; organization: string; website: string | null; description: string | null; reason: string | null };

export function useMyRecruiter(userId: string | undefined) {
  return useQuery({
    queryKey: ["jobs", "recruiter", userId],
    enabled: getSupabase() !== null && !!userId,
    queryFn: async (): Promise<Recruiter | null> => {
      const { data, error } = await requireSupabase().from("recruiters").select("status, organization_name, website, description, status_reason").eq("user_id", userId!).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const r = data as { status: RecruiterStatus; organization_name: string; website: string | null; description: string | null; status_reason: string | null };
      return { status: r.status, organization: r.organization_name, website: r.website, description: r.description, reason: r.status_reason };
    },
  });
}

export function useRequestRecruiter(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { organization: string; website: string; description: string }) => rpc("request_recruiter", { p_organization: v.organization, p_website: v.website, p_description: v.description }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs", "recruiter", userId] }),
  });
}

export type OfferDraft = {
  kind: JobKind; title: string; description: string; responsibilities: string; skills: string[]; level: JobLevel; domain: string; countryCode: string;
  city: string; workMode: WorkMode; compensation: string; deadline: string; questions: string[];
};
export const emptyOffer: OfferDraft = { kind: "stage", title: "", description: "", responsibilities: "", skills: [], level: "tous", domain: "", countryCode: "", city: "", workMode: "sur_site", compensation: "", deadline: "", questions: [] };

export type MyOffer = OfferDraft & { id: string; status: OfferStatus; statusReason: string | null; applications: number };

export function useMyOffers(userId: string | undefined) {
  return useQuery({
    queryKey: ["jobs", "my-offers", userId],
    enabled: getSupabase() !== null && !!userId,
    queryFn: async (): Promise<MyOffer[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from("job_offers").select("*").eq("recruiter_id", userId!).order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as (Omit<FeedRow, "organization_name" | "organization_website" | "organization_description" | "organization_verified" | "has_applied">)[];
      const counts = new Map<string, number>();
      if (rows.length) {
        const { data: apps, error: e2 } = await sb.from("job_applications").select("offer_id").in("offer_id", rows.map((r) => r.id));
        if (e2) throw e2;
        for (const a of (apps ?? []) as { offer_id: string }[]) counts.set(a.offer_id, (counts.get(a.offer_id) ?? 0) + 1);
      }
      return rows.map((r) => ({
        id: r.id, kind: r.kind, title: r.title, description: r.description, responsibilities: r.responsibilities ?? "", skills: r.skills, level: r.level, domain: r.domain ?? "",
        countryCode: r.country_code?.trim() ?? "", city: r.city ?? "", workMode: r.work_mode, compensation: r.compensation ?? "", deadline: r.deadline ?? "", questions: r.questions,
        status: r.status, statusReason: r.status_reason, applications: counts.get(r.id) ?? 0,
      }));
    },
  });
}

export function useOfferActions(userId: string | undefined) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["jobs", "my-offers", userId] }), qc.invalidateQueries({ queryKey: ["jobs", "feed"] })]);
  const payload = (d: OfferDraft) => ({
    kind: d.kind, title: d.title.trim(), description: d.description.trim(), responsibilities: d.responsibilities.trim() || null,
    skills: d.skills.map((s) => s.trim()).filter(Boolean).slice(0, 15), level: d.level, domain: d.domain.trim() || null, country_code: d.countryCode || null,
    city: d.city.trim() || null, work_mode: d.workMode, compensation: d.compensation.trim() || null, deadline: d.deadline || null,
    questions: d.questions.map((s) => s.trim()).filter(Boolean).slice(0, 5),
  });
  const save = useMutation({
    mutationFn: async ({ id, draft }: { id?: string | undefined; draft: OfferDraft }) => {
      if (draft.title.trim().length < 5) throw new UserFacingError("Le titre doit faire au moins 5 caractères.");
      if (draft.description.trim().length < 30) throw new UserFacingError("La description doit faire au moins 30 caractères.");
      const sb = requireSupabase();
      if (id) {
        const { data, error } = await sb.from("job_offers").update(payload(draft)).eq("id", id).select("id");
        if (error) throw error;
        if (!data?.length) throw new UserFacingError("Cette offre n'est plus modifiable : repassez-la en brouillon d'abord.");
        return id;
      }
      const { data, error } = await sb.from("job_offers").insert({ ...payload(draft), recruiter_id: userId!, status: "draft" }).select("id").single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: refresh,
  });
  const submit = useMutation({ mutationFn: (id: string) => rpc("submit_job_offer", { p_offer_id: id }), onSuccess: refresh });
  const setState = useMutation({ mutationFn: ({ id, state }: { id: string; state: "closed" | "archived" | "draft" }) => rpc("set_job_offer_state", { p_offer_id: id, p_state: state }), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await requireSupabase().from("job_offers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  return { save, submit, setState, remove };
}

export type Snapshot = { name?: string; campus?: string; headline?: string; summary?: string; skills?: string[]; education?: ProItem[]; experiences?: ProItem[]; projects?: ProItem[]; portfolio_url?: string };
export type OfferApplication = {
  id: string; applicantId: string; status: ApplicationStatus; message: string | null; answers: string[]; snapshot: Snapshot | null; cvPath: string | null;
  createdAt: string; note: string; events: { status: ApplicationStatus; at: string }[]; applicantName: string;
};

export function useOfferApplications(offerId: string | undefined) {
  return useQuery({
    queryKey: ["jobs", "offer-applications", offerId],
    enabled: getSupabase() !== null && !!offerId,
    queryFn: async (): Promise<OfferApplication[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from("job_applications").select("id, applicant_id, status, message, answers, profile_snapshot, cv_path, created_at").eq("offer_id", offerId!).order("created_at", { ascending: false });
      if (error) throw error;
      const apps = (data ?? []) as { id: string; applicant_id: string; status: ApplicationStatus; message: string | null; answers: string[]; profile_snapshot: Snapshot | null; cv_path: string | null; created_at: string }[];
      if (!apps.length) return [];
      const ids = apps.map((a) => a.id);
      const [notes, events, people] = await Promise.all([
        sb.from("job_application_notes").select("application_id, note").in("application_id", ids),
        sb.from("job_application_events").select("application_id, status, created_at").in("application_id", ids).order("created_at"),
        sb.from("profiles").select("id, full_name").in("id", apps.map((a) => a.applicant_id)),
      ]);
      const noteBy = new Map(((notes.data ?? []) as { application_id: string; note: string }[]).map((n) => [n.application_id, n.note]));
      const nameBy = new Map(((people.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
      const evs = (events.data ?? []) as { application_id: string; status: ApplicationStatus; created_at: string }[];
      return apps.map((a) => ({
        id: a.id, applicantId: a.applicant_id, status: a.status, message: a.message, answers: a.answers, snapshot: a.profile_snapshot, cvPath: a.cv_path, createdAt: a.created_at,
        note: noteBy.get(a.id) ?? "", events: evs.filter((e) => e.application_id === a.id).map((e) => ({ status: e.status, at: e.created_at })),
        applicantName: a.profile_snapshot?.name ?? nameBy.get(a.applicant_id) ?? "Candidat",
      }));
    },
  });
}

export function useSetApplicationStatus(offerId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: Exclude<ApplicationStatus, "received" | "withdrawn">; note: string }) => rpc("set_application_status", { p_application_id: id, p_status: status, p_note: note }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["jobs", "offer-applications", offerId] })]),
  });
}

/* ---------- Administration ---------- */
export type AdminRecruiter = { userId: string; organization: string; website: string | null; description: string | null; status: RecruiterStatus; reason: string | null; createdAt: string };
export type AdminOffer = { id: string; title: string; kind: JobKind; organization: string; status: OfferStatus; description: string; createdAt: string; countryCode: string | null; city: string | null };

export function useAdminJobs() {
  return useQuery({
    queryKey: ["jobs", "admin"],
    enabled: getSupabase() !== null,
    queryFn: async () => {
      const sb = requireSupabase();
      const [rec, off] = await Promise.all([
        sb.from("recruiters").select("user_id, organization_name, website, description, status, status_reason, created_at").order("created_at", { ascending: false }).limit(200),
        sb.from("job_offers_feed").select("id, title, kind, organization_name, status, description, created_at, country_code, city").in("status", ["pending_review", "published", "suspended"]).order("created_at", { ascending: false }).limit(200),
      ]);
      if (rec.error) throw rec.error;
      if (off.error) throw off.error;
      const recruiters = ((rec.data ?? []) as { user_id: string; organization_name: string; website: string | null; description: string | null; status: RecruiterStatus; status_reason: string | null; created_at: string }[])
        .map((r): AdminRecruiter => ({ userId: r.user_id, organization: r.organization_name, website: r.website, description: r.description, status: r.status, reason: r.status_reason, createdAt: r.created_at }));
      const offers = ((off.data ?? []) as { id: string; title: string; kind: JobKind; organization_name: string; status: OfferStatus; description: string; created_at: string; country_code: string | null; city: string | null }[])
        .map((o): AdminOffer => ({ id: o.id, title: o.title, kind: o.kind, organization: o.organization_name, status: o.status, description: o.description, createdAt: o.created_at, countryCode: o.country_code?.trim() ?? null, city: o.city }));
      return { recruiters, offers };
    },
  });
}

export function useAdminJobActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["jobs"] });
  return {
    reviewRecruiter: useMutation({ mutationFn: (v: { userId: string; status: "verified" | "rejected" | "suspended"; reason: string }) => rpc("admin_review_recruiter", { p_user_id: v.userId, p_status: v.status, p_reason: v.reason }), onSuccess: refresh }),
    reviewOffer: useMutation({ mutationFn: (v: { id: string; decision: "approve" | "reject" | "suspend" | "restore"; reason: string }) => rpc("admin_review_job_offer", { p_offer_id: v.id, p_decision: v.decision, p_reason: v.reason }), onSuccess: refresh }),
  };
}
