import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { UserFacingError } from "./errors";

/* Tutorat (migrations 0063 et 0068) : annuaire des tuteurs, profil tuteur, demandes de séance, paiement, avis.
 * Toutes les écritures passent par des fonctions de la base qui répondent { success, error } ; le prix vient de la base
 * (figé à la demande, jamais calculé par l'écran). Un profil vérifié est requis pour devenir tuteur. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTutorId = (s: string) => UUID.test(s);

export type TutorMode = "online" | "in_person" | "both";
export type SessionMode = "online" | "in_person";
export const MODE_LABEL: Record<TutorMode, string> = { online: "En ligne", in_person: "En présentiel", both: "En ligne ou en présentiel" };
export const DURATIONS = [30, 45, 60, 90, 120, 180, 240];
export const durationLabel = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}` : `${m} min`);

export type Tutor = {
  userId: string; name: string; avatarUrl: string | null; campus: string | null; verified: boolean; filiere: string | null; niveau: string | null;
  university: string | null; subjects: string[]; bio: string; availability: string; mode: TutorMode; hourlyPrice: number;
  rating: number; reviewsCount: number; sessionsCount: number;
};
export type MyTutorProfile = { subjects: string[]; bio: string; availability: string; mode: TutorMode; hourlyPrice: number; active: boolean; rating: number; reviewsCount: number; sessionsCount: number };
export type TutorReview = { requestId: string; rating: number; comment: string | null; createdAt: string; studentName: string };
export type RequestStatus = "pending" | "accepted" | "declined" | "cancelled" | "completed";
export type PaymentStatus = "not_required" | "unpaid" | "paid";
export type TutoringRequest = {
  id: string; studentId: string; tutorId: string; subject: string; message: string | null; mode: SessionMode; proposedAt: string | null; status: RequestStatus;
  scheduledAt: string | null; location: string | null; tutorNote: string | null; createdAt: string; durationMinutes: number; price: number;
  paymentStatus: PaymentStatus; payBy: string | null; refundStatus: "none" | "due" | "done"; studentName: string; tutorName: string; reviewed: boolean;
};

type TutorRow = {
  user_id: string; subjects: string[]; bio: string | null; availability: string | null; mode: TutorMode; hourly_price: number; rating_avg: number | string;
  reviews_count: number; sessions_count: number; full_name: string | null; avatar_url: string | null; campus: string | null; verified: boolean | null;
  filiere: string | null; niveau: string | null; university_short_name: string | null;
};
const TUTOR_SELECT = "user_id, subjects, bio, availability, mode, hourly_price, rating_avg, reviews_count, sessions_count, full_name, avatar_url, campus, verified, filiere, niveau, university_short_name";
const toTutor = (r: TutorRow): Tutor => ({
  userId: r.user_id, name: r.full_name?.trim() || "Étudiant", avatarUrl: r.avatar_url, campus: r.campus, verified: r.verified === true, filiere: r.filiere, niveau: r.niveau,
  university: r.university_short_name, subjects: r.subjects ?? [], bio: r.bio ?? "", availability: r.availability ?? "", mode: r.mode, hourlyPrice: Number(r.hourly_price ?? 0),
  rating: Number(r.rating_avg ?? 0), reviewsCount: Number(r.reviews_count ?? 0), sessionsCount: Number(r.sessions_count ?? 0),
});

export async function fetchTutors(): Promise<Tutor[]> {
  const { data, error } = await requireSupabase().from("tutors_directory").select(TUTOR_SELECT).order("rating_avg", { ascending: false }).order("sessions_count", { ascending: false }).limit(200);
  if (error) throw error;
  return ((data ?? []) as unknown as TutorRow[]).map(toTutor);
}

export async function fetchTutor(id: string): Promise<Tutor | null> {
  if (!isTutorId(id)) return null;
  const { data, error } = await requireSupabase().from("tutors_directory").select(TUTOR_SELECT).eq("user_id", id).maybeSingle();
  if (error) throw error;
  return data ? toTutor(data as unknown as TutorRow) : null;
}

export async function fetchTutorReviews(tutorId: string): Promise<TutorReview[]> {
  const { data, error } = await requireSupabase().from("tutor_reviews_list").select("request_id, rating, comment, created_at, student_name").eq("tutor_id", tutorId).order("created_at", { ascending: false }).limit(30);
  if (error) throw error;
  return ((data ?? []) as { request_id: string; rating: number; comment: string | null; created_at: string; student_name: string | null }[])
    .map((r) => ({ requestId: r.request_id, rating: Number(r.rating), comment: r.comment, createdAt: r.created_at, studentName: r.student_name?.trim() || "Étudiant" }));
}

export async function fetchMyTutorProfile(userId: string): Promise<MyTutorProfile | null> {
  const { data, error } = await requireSupabase().from("tutor_profiles").select("subjects, bio, availability, mode, hourly_price, active, rating_avg, reviews_count, sessions_count").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as { subjects: string[]; bio: string | null; availability: string | null; mode: TutorMode; hourly_price: number; active: boolean; rating_avg: number | string; reviews_count: number; sessions_count: number };
  return { subjects: r.subjects ?? [], bio: r.bio ?? "", availability: r.availability ?? "", mode: r.mode, hourlyPrice: Number(r.hourly_price ?? 0), active: r.active === true, rating: Number(r.rating_avg ?? 0), reviewsCount: Number(r.reviews_count ?? 0), sessionsCount: Number(r.sessions_count ?? 0) };
}

type RequestRow = {
  id: string; student_id: string; tutor_id: string; subject: string; message: string | null; mode: SessionMode; proposed_at: string | null; status: RequestStatus;
  scheduled_at: string | null; location: string | null; tutor_note: string | null; created_at: string; duration_minutes: number; price: number;
  payment_status: PaymentStatus; pay_by: string | null; refund_status: "none" | "due" | "done"; student_name: string | null; tutor_name: string | null; reviewed: boolean | null;
};
export async function fetchMyRequests(userId: string): Promise<TutoringRequest[]> {
  const { data, error } = await requireSupabase().from("tutoring_requests_list")
    .select("id, student_id, tutor_id, subject, message, mode, proposed_at, status, scheduled_at, location, tutor_note, created_at, duration_minutes, price, payment_status, pay_by, refund_status, student_name, tutor_name, reviewed")
    .or(`student_id.eq.${userId},tutor_id.eq.${userId}`).order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return ((data ?? []) as unknown as RequestRow[]).map((r) => ({
    id: r.id, studentId: r.student_id, tutorId: r.tutor_id, subject: r.subject, message: r.message, mode: r.mode, proposedAt: r.proposed_at, status: r.status,
    scheduledAt: r.scheduled_at, location: r.location, tutorNote: r.tutor_note, createdAt: r.created_at, durationMinutes: Number(r.duration_minutes ?? 60),
    price: Number(r.price ?? 0), paymentStatus: r.payment_status, payBy: r.pay_by, refundStatus: r.refund_status, studentName: r.student_name?.trim() || "Étudiant",
    tutorName: r.tutor_name?.trim() || "Tuteur", reviewed: r.reviewed === true,
  }));
}

/** Tutorat payant activé par l'administration ? (sinon tout est gratuit). */
export async function fetchPaidTutoringEnabled(): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc("get_platform_flags");
  if (error) throw error;
  return (data as Record<string, boolean> | null)?.["paid_tutoring"] === true;
}

const enabled = () => getSupabase() !== null;
export const useTutors = () => useQuery({ queryKey: ["tutoring", "tutors"], queryFn: fetchTutors, enabled: enabled(), staleTime: 30_000 });
export const useTutor = (id: string) => useQuery({ queryKey: ["tutoring", "tutor", id], queryFn: () => fetchTutor(id), enabled: enabled() && isTutorId(id), staleTime: 30_000 });
export const useTutorReviews = (id: string) => useQuery({ queryKey: ["tutoring", "reviews", id], queryFn: () => fetchTutorReviews(id), enabled: enabled() && isTutorId(id), staleTime: 30_000 });
export const useMyTutorProfile = (userId: string | undefined) => useQuery({ queryKey: ["tutoring", "profile", userId], queryFn: () => fetchMyTutorProfile(userId!), enabled: enabled() && !!userId, staleTime: 15_000 });
export const useMyRequests = (userId: string | undefined) => useQuery({ queryKey: ["tutoring", "requests", userId], queryFn: () => fetchMyRequests(userId!), enabled: enabled() && !!userId, staleTime: 10_000 });
export const usePaidTutoring = () => useQuery({ queryKey: ["tutoring", "paid-flag"], queryFn: fetchPaidTutoringEnabled, enabled: enabled(), staleTime: 60_000 });

const ERRORS: Record<string, string> = {
  forbidden: "Votre compte ne permet pas cette action pour le moment.",
  invalid_mode: "Mode de séance invalide.", invalid_subjects: "Indiquez de 1 à 8 matières (2 à 60 caractères chacune).",
  invalid_bio: "La présentation est limitée à 500 caractères.", invalid_availability: "Les disponibilités sont limitées à 300 caractères.",
  invalid_price: "Prix horaire : de 500 à 50 000 FCFA.",
  paid_tutoring_disabled: "Le tutorat payant n'est pas encore activé : proposez vos séances gratuitement pour le moment.",
  verification_required: "Seuls les profils vérifiés peuvent devenir tuteurs. Faites d'abord vérifier votre profil.",
  own_profile: "Vous ne pouvez pas demander une séance à vous-même.", unavailable: "Ce tuteur n'est pas disponible pour le moment.",
  mode_unavailable: "Ce tuteur ne propose pas ce mode de séance.", subject_unavailable: "Ce tuteur ne propose pas cette matière.",
  invalid_message: "Le message est limité à 500 caractères.", invalid_date: "La date doit être dans le futur.", invalid_duration: "Durée : de 30 minutes à 4 heures.",
  already_requested: "Vous avez déjà une demande en cours avec ce tuteur.", rate_limited: "Vous avez atteint la limite quotidienne de demandes. Réessayez demain.",
  not_found: "Demande introuvable.", invalid_status: "Cette demande a changé entre-temps : actualisez la page.",
  invalid_location: "Indiquez le lieu ou le lien de la séance (2 à 200 caractères).", invalid_note: "La note est limitée à 300 caractères.",
  too_soon_for_paid: "Une séance payante doit commencer dans au moins 2 heures, pour laisser le temps de payer.",
  too_early: "La séance n'a pas encore eu lieu.", payment_required: "La séance doit d'abord être payée.",
  too_early_for_tutor: "Pour une séance payante, l'élève confirme la fin de séance ; le tuteur peut la clôturer 72 h après l'heure prévue.",
  invalid_rating: "Choisissez une note de 1 à 5.", invalid_comment: "Le commentaire est limité à 500 caractères.", already_reviewed: "Vous avez déjà noté cette séance.",
};

type Envelope = { success?: boolean; error?: string };
async function rpc<T extends Envelope = Envelope>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().rpc(fn, args);
  if (error) throw error;
  const r = data as T | null;
  if (!r?.success) throw new UserFacingError(ERRORS[r?.error ?? ""] ?? "Action impossible. Réessayez dans un instant.");
  return r;
}

const nullIfEmpty = (s: string) => (s.trim() === "" ? null : s.trim());

export function useTutoringActions() {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["tutoring"] }); void qc.invalidateQueries({ queryKey: ["notifications"] }); };
  return {
    saveProfile: useMutation({
      mutationFn: (v: { subjects: string[]; bio: string; availability: string; mode: TutorMode; active: boolean; hourlyPrice: number }) =>
        rpc("save_tutor_profile", { p_subjects: v.subjects, p_bio: v.bio, p_availability: v.availability, p_mode: v.mode, p_active: v.active, p_hourly_price: v.hourlyPrice }), onSettled: refresh,
    }),
    request: useMutation({
      mutationFn: (v: { tutorId: string; subject: string; message: string; mode: SessionMode; proposedAt: string | null; durationMinutes: number }) =>
        rpc<Envelope & { id: string; price: number }>("request_tutoring", { p_tutor: v.tutorId, p_subject: v.subject, p_message: v.message, p_mode: v.mode, p_proposed_at: v.proposedAt, p_duration_minutes: v.durationMinutes }), onSettled: refresh,
    }),
    respond: useMutation({
      mutationFn: (v: { id: string; accept: boolean; scheduledAt: string | null; location: string; note: string }) =>
        rpc("respond_tutoring_request", { p_request: v.id, p_accept: v.accept, p_scheduled_at: v.scheduledAt, p_location: nullIfEmpty(v.location), p_note: nullIfEmpty(v.note) }), onSettled: refresh,
    }),
    cancel: useMutation({ mutationFn: (id: string) => rpc<Envelope & { refund_due?: boolean }>("cancel_tutoring_request", { p_request: id }), onSettled: refresh }),
    complete: useMutation({ mutationFn: (id: string) => rpc("complete_tutoring_request", { p_request: id }), onSettled: refresh }),
    review: useMutation({ mutationFn: (v: { id: string; rating: number; comment: string }) => rpc("review_tutor", { p_request: v.id, p_rating: v.rating, p_comment: nullIfEmpty(v.comment) }), onSettled: refresh }),
  };
}
