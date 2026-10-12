import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase, requireSupabase } from "../supabase";

/* Vérification du compte étudiant : l'utilisateur dépose un justificatif (bucket privé verification-documents, dossier
 * <uid>/), puis la demande est examinée par le personnel (admin_review_verification). L'utilisateur ne peut ni
 * s'auto-approuver ni relire les documents des autres : voir 0020. */

export type VerificationDocType = "student_card" | "other_document";
export type VerificationStatus = "pending" | "approved" | "rejected";
export type VerificationRequest = { id: string; documentType: VerificationDocType; status: VerificationStatus; rejectionReason: string | null; createdAt: string; reviewedAt: string | null };

export const VERIFICATION_BUCKET = "verification-documents";
export const VERIFICATION_MAX_BYTES = 5 * 1024 * 1024;
export const VERIFICATION_TYPES = ["image/jpeg", "image/png", "application/pdf"];

type Row = { id: string; document_type: VerificationDocType; status: VerificationStatus; rejection_reason: string | null; created_at: string; reviewed_at: string | null };

/** Dernière demande de l'utilisateur (la plus récente), ou null s'il n'en a jamais déposé. */
export async function fetchLatestVerification(userId: string): Promise<VerificationRequest | null> {
  const { data, error } = await requireSupabase()
    .from("verification_requests")
    .select("id, document_type, status, rejection_reason, created_at, reviewed_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as Row;
  return { id: r.id, documentType: r.document_type, status: r.status, rejectionReason: r.rejection_reason, createdAt: r.created_at, reviewedAt: r.reviewed_at };
}

export function checkVerificationFile(file: File): string | null {
  if (!VERIFICATION_TYPES.includes(file.type)) return "Format non pris en charge : JPG, PNG ou PDF.";
  if (file.size > VERIFICATION_MAX_BYTES) return `Fichier trop lourd (${(file.size / 1024 / 1024).toFixed(1).replace(".", ",")} Mo). Maximum : 5 Mo.`;
  return null;
}

/** Envoie les fichiers puis crée la demande. Si la demande échoue, les fichiers déjà envoyés sont retirés. */
export async function submitVerification(userId: string, documentType: VerificationDocType, files: File[]): Promise<void> {
  if (files.length < 1 || files.length > 2) throw new Error("Ajoutez un ou deux fichiers.");
  for (const f of files) {
    const problem = checkVerificationFile(f);
    if (problem) throw new Error(problem);
  }
  const sb = requireSupabase();
  const paths: string[] = [];
  try {
    for (const f of files) {
      const ext = f.type === "application/pdf" ? "pdf" : f.type === "image/png" ? "png" : "jpg";
      const path = `${userId}/${Date.now()}-${paths.length}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const up = await sb.storage.from(VERIFICATION_BUCKET).upload(path, f, { contentType: f.type, upsert: false });
      if (up.error) throw up.error;
      paths.push(path);
    }
    const { error } = await sb.from("verification_requests").insert({ user_id: userId, document_type: documentType, document_paths: paths });
    if (error) throw error;
  } catch (e) {
    if (paths.length) await sb.storage.from(VERIFICATION_BUCKET).remove(paths);
    throw e;
  }
}

export const verificationKey = (userId: string | undefined) => ["verification", userId] as const;

export function useLatestVerification(userId: string | undefined) {
  return useQuery({ queryKey: verificationKey(userId), queryFn: () => fetchLatestVerification(userId!), enabled: !!userId && getSupabase() !== null, staleTime: 15_000 });
}

export function useSubmitVerification(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, files }: { type: VerificationDocType; files: File[] }) => submitVerification(userId!, type, files),
    onSuccess: () => qc.invalidateQueries({ queryKey: verificationKey(userId) }),
  });
}
