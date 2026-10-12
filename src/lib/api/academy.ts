import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";
import { levelFromDb, styleOfCategory, type ArticleBlock, type Course, type CourseModule, type ModuleKind } from "../academy-model";

/* Campus Academy : catalogue public (formations publiées), inscription, progression, avis et certificat.
 * Les droits sont tenus par la base : le contenu d'un module n'est lisible que pour un aperçu ou par une personne
 * inscrite (politiques de course_module_content et du bucket privé course-media). Le prix et le statut d'inscription
 * sont contrôlés côté base : une inscription gratuite ne peut être créée que si le prix est 0. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

const COURSE_SELECT =
  "id, category_slug, title, tagline, description, level, instructor_name, instructor_role, instructor_bio, price, rating_avg, reviews_count, enrolled_count, updated_at, learning_outcomes, requirements, category:course_categories!category_slug(name), modules:course_modules(id, title, kind, position, duration_minutes, is_preview)";

type ModuleRow = { id: string; title: string; kind: ModuleKind; position: number; duration_minutes: number; is_preview: boolean };
type CourseRow = {
  id: string; category_slug: string; title: string; tagline: string | null; description: string; level: string;
  instructor_name: string; instructor_role: string | null; instructor_bio: string | null; price: number;
  rating_avg: number | string; reviews_count: number; enrolled_count: number; updated_at: string;
  learning_outcomes: string[] | null; requirements: string[] | null;
  category: { name: string } | { name: string }[] | null; modules: ModuleRow[] | null;
};

function toCourse(r: CourseRow): Course {
  const cat = Array.isArray(r.category) ? r.category[0] : r.category;
  const style = styleOfCategory(r.category_slug);
  const modules: CourseModule[] = [...(r.modules ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((m) => ({ id: m.id, title: m.title, kind: m.kind, minutes: m.duration_minutes, preview: m.is_preview }));
  return {
    id: r.id, title: r.title, tagline: r.tagline ?? "", description: r.description,
    category: cat?.name ?? r.category_slug, categorySlug: r.category_slug, level: levelFromDb[r.level] ?? "Débutant",
    instructor: { name: r.instructor_name, role: r.instructor_role ?? "", bio: r.instructor_bio ?? "" },
    price: r.price, students: r.enrolled_count, rating: Math.round(Number(r.rating_avg) * 10) / 10, reviews: r.reviews_count,
    updatedAt: r.updated_at, icon: style.icon, tone: style.tone,
    learn: r.learning_outcomes ?? [], requirements: r.requirements ?? [], modules,
  };
}

export async function fetchCourses(): Promise<Course[]> {
  const { data, error } = await requireSupabase().from("courses").select(COURSE_SELECT).eq("status", "published").order("enrolled_count", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as CourseRow[]).map(toCourse);
}

export async function fetchCourse(id: string): Promise<Course | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await requireSupabase().from("courses").select(COURSE_SELECT).eq("id", id).eq("status", "published").maybeSingle();
  if (error) throw error;
  return data ? toCourse(data as unknown as CourseRow) : null;
}

export type CourseCategoryRow = { slug: string; name: string };
export async function fetchCourseCategories(): Promise<CourseCategoryRow[]> {
  const { data, error } = await requireSupabase().from("course_categories").select("slug, name").order("sort_order");
  if (error) throw error;
  return (data ?? []) as CourseCategoryRow[];
}

/* ---------- Apprenant : inscriptions et progression ---------- */
export type Learner = { enrolled: ReadonlySet<string>; pending: ReadonlySet<string>; completed: ReadonlySet<string> };

export async function fetchLearner(userId: string): Promise<Learner> {
  const sb = requireSupabase();
  const [enr, prog] = await Promise.all([
    sb.from("course_enrollments").select("course_id, status").eq("user_id", userId),
    sb.from("module_progress").select("module_id, completed_at").eq("user_id", userId).order("completed_at", { ascending: false }),
  ]);
  if (enr.error) throw enr.error;
  if (prog.error) throw prog.error;
  const rows = (enr.data ?? []) as { course_id: string; status: string }[];
  return {
    enrolled: new Set(rows.filter((r) => r.status === "active").map((r) => r.course_id)),
    pending: new Set(rows.filter((r) => r.status === "pending_payment").map((r) => r.course_id)),
    completed: new Set(((prog.data ?? []) as { module_id: string }[]).map((r) => r.module_id)),
  };
}

const learnerKey = (userId: string | undefined) => ["academy", "learner", userId] as const;

export function useCourses() {
  return useQuery({ queryKey: ["academy", "courses"], queryFn: fetchCourses, enabled: getSupabase() !== null, staleTime: 60_000 });
}
export function useCourse(id: string) {
  return useQuery({ queryKey: ["academy", "course", id], queryFn: () => fetchCourse(id), enabled: getSupabase() !== null, staleTime: 30_000 });
}
export function useLearner(userId: string | undefined) {
  return useQuery({ queryKey: learnerKey(userId), queryFn: () => fetchLearner(userId!), enabled: !!userId && getSupabase() !== null, staleTime: 15_000 });
}

export type Mutations = ReturnType<typeof useAcademyActions>;

export function useAcademyActions(userId: string | undefined) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: learnerKey(userId) }), qc.invalidateQueries({ queryKey: ["academy", "courses"] }), qc.invalidateQueries({ queryKey: ["academy", "course"] })]);
  return {
    refresh,
    /** Inscription à une formation GRATUITE. Si l'inscription existe déjà (code 23505), c'est un succès. */
    enrollFree: useMutation({
      mutationFn: async (courseId: string) => {
        const { error } = await requireSupabase().from("course_enrollments").insert({ course_id: courseId, user_id: userId!, unit_price: 0, idempotency_key: crypto.randomUUID(), status: "active" });
        if (error && error.code !== "23505") throw error;
      },
      onSuccess: refresh,
    }),
    /** Marque un module comme terminé (idempotent). Le certificat est délivré par la base au dernier module. */
    completeModule: useMutation({
      mutationFn: async (moduleId: string) => {
        const { error } = await requireSupabase().from("module_progress").insert({ user_id: userId!, module_id: moduleId });
        if (error && error.code !== "23505") throw error;
      },
      onSuccess: async () => { await refresh(); void qc.invalidateQueries({ queryKey: ["academy", "certificate"] }); },
    }),
  };
}

/* ---------- Contenu d'un module ---------- */
export type ModuleContent = { kind: ModuleKind; url: string | null; article: ArticleBlock[] | null };

const BLOCK_TYPES = new Set(["h", "p", "callout", "code", "list"]);
function parseArticle(raw: unknown): ArticleBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((b): ArticleBlock[] => {
    if (!b || typeof b !== "object") return [];
    const o = b as { type?: unknown; text?: unknown; items?: unknown };
    if (typeof o.type !== "string" || !BLOCK_TYPES.has(o.type)) return [];
    const block: ArticleBlock = { type: o.type as ArticleBlock["type"] };
    if (typeof o.text === "string") block.text = o.text;
    if (Array.isArray(o.items)) block.items = o.items.filter((i): i is string => typeof i === "string");
    return [block];
  });
}

/** Contenu d'un module, ou null si l'accès est refusé / le contenu n'est pas encore publié. L'URL signée dure 1 h. */
export async function fetchModuleContent(moduleId: string, kind: ModuleKind): Promise<ModuleContent | null> {
  const sb = requireSupabase();
  const { data, error } = await sb.from("course_module_content").select("media_path, article_content").eq("module_id", moduleId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { media_path: string | null; article_content: unknown };
  if (kind === "article") return { kind, url: null, article: parseArticle(row.article_content) };
  if (!row.media_path) return null;
  const signed = await sb.storage.from("course-media").createSignedUrl(row.media_path, 3600);
  if (signed.error) throw signed.error;
  return { kind, url: signed.data.signedUrl, article: null };
}

export function useModuleContent(moduleId: string, kind: ModuleKind, enabled: boolean) {
  return useQuery({ queryKey: ["academy", "module-content", moduleId], queryFn: () => fetchModuleContent(moduleId, kind), enabled: enabled && getSupabase() !== null, staleTime: 30 * 60_000 });
}

/* ---------- Avis ---------- */
export type CourseReview = { id: string; userId: string; author: string; rating: number; text: string; createdAt: string };

export async function fetchCourseReviews(courseId: string): Promise<CourseReview[]> {
  const { data, error } = await requireSupabase().from("course_reviews").select("id, user_id, rating, body, created_at, author:profiles!user_id(full_name)").eq("course_id", courseId).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  type Row = { id: string; user_id: string; rating: number; body: string | null; created_at: string; author: { full_name: string } | { full_name: string }[] | null };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const a = Array.isArray(r.author) ? r.author[0] : r.author;
    return { id: r.id, userId: r.user_id, author: a?.full_name ?? "Étudiant", rating: r.rating, text: r.body ?? "", createdAt: r.created_at };
  });
}

export function useCourseReviews(courseId: string) {
  return useQuery({ queryKey: ["academy", "reviews", courseId], queryFn: () => fetchCourseReviews(courseId), enabled: getSupabase() !== null && isUuid(courseId), staleTime: 30_000 });
}

/** Crée ou met à jour l'avis de l'utilisateur (un seul par formation). */
export function useSaveReview(courseId: string, userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ rating, text }: { rating: number; text: string }) => {
      const sb = requireSupabase();
      const body = text.trim() || null;
      const existing = await sb.from("course_reviews").select("id").eq("course_id", courseId).eq("user_id", userId!).maybeSingle();
      if (existing.error) throw existing.error;
      const res = existing.data
        ? await sb.from("course_reviews").update({ rating, body }).eq("id", (existing.data as { id: string }).id)
        : await sb.from("course_reviews").insert({ course_id: courseId, user_id: userId!, rating, body });
      if (res.error) throw res.error;
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["academy", "reviews", courseId] }), qc.invalidateQueries({ queryKey: ["academy", "course", courseId] }), qc.invalidateQueries({ queryKey: ["academy", "courses"] })]),
  });
}

/* ---------- Certificat ---------- */
export type CertificateRow = { code: string; issuedAt: string };

export async function fetchCertificate(userId: string, courseId: string): Promise<CertificateRow | null> {
  if (!isUuid(courseId)) return null;
  const { data, error } = await requireSupabase().from("certificates").select("certificate_code, issued_at").eq("user_id", userId).eq("course_id", courseId).maybeSingle();
  if (error) throw error;
  const r = data as { certificate_code: string; issued_at: string } | null;
  return r ? { code: r.certificate_code, issuedAt: r.issued_at } : null;
}

export function useCertificate(userId: string | undefined, courseId: string) {
  return useQuery({ queryKey: ["academy", "certificate", userId, courseId], queryFn: () => fetchCertificate(userId!, courseId), enabled: !!userId && getSupabase() !== null, staleTime: 30_000 });
}
