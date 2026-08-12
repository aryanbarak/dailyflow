import { supabase } from "@/integrations/supabase/client";

export const DOCUMENTS_BUCKET =
  import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || "documents";

/** Task 18 (Document-Sourced Memory slice 2): the four recognized document types -- see 20260812000000_document_types_and_sensitivity.sql's own CHECK constraint. Widened from task 16's resume-only set. */
export type DocumentType = "resume" | "financial" | "personal" | "business";
export const DOCUMENT_TYPES: readonly DocumentType[] = ["resume", "financial", "personal", "business"];

export interface Document {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  title: string | null;
  description: string | null;
  tags: string[];
  /** Task 16/18 (Document-Sourced Memory): one of DOCUMENT_TYPES when explicitly assigned, else null (untyped -- no "Add to personal memory" action shown). Loosely typed as `string | null` here (matching the generated-Supabase-types convention this repo already uses for this column) rather than `DocumentType | null`, so an old/foreign value never fails to type-check; callers narrow via isSupportedDocumentType where it matters. */
  type: string | null;
  aiSummary: string | null;
  aiSummaryPoints: string[];
  extractedTasksCount: number;
  lastOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const SELECT_COLS =
  'id,storage_path,file_name,mime_type,size_bytes,title,description,tags,type,ai_summary,ai_summary_points,extracted_tasks_count,last_opened_at,created_at,updated_at';

interface RawRow {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  type: string | null;
  ai_summary: string | null;
  ai_summary_points: unknown;
  extracted_tasks_count: number | null;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: RawRow): Document {
  return {
    id: row.id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    title: row.title,
    description: row.description,
    tags: Array.isArray(row.tags) ? row.tags : [],
    type: row.type,
    aiSummary: row.ai_summary,
    aiSummaryPoints: Array.isArray(row.ai_summary_points) ? row.ai_summary_points as string[] : [],
    extractedTasksCount: row.extracted_tasks_count ?? 0,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDocuments(): Promise<Document[]> {
  const { data, error } = await supabase
    .from("documents")
    .select(SELECT_COLS)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => mapRow(row as unknown as RawRow));
}

export async function createDocument(meta: {
  storagePath: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  title?: string | null;
  description?: string | null;
}): Promise<Document> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error(userError?.message || "Not authenticated");
  }
  const { data, error } = await supabase
    .from("documents")
    .insert({
      user_id: userData.user.id,
      storage_path: meta.storagePath,
      file_name: meta.fileName,
      mime_type: meta.mimeType ?? null,
      size_bytes: meta.sizeBytes ?? null,
      title: meta.title ?? null,
      description: meta.description ?? null,
    })
    .select(SELECT_COLS)
    .single();
  if (error || !data) throw error ?? new Error("Failed to create document");
  return mapRow(data as unknown as RawRow);
}

export async function updateDocument(
  id: string,
  patch: { title?: string | null; description?: string | null },
): Promise<Document> {
  const { data, error } = await supabase
    .from("documents")
    .update({
      title: patch.title === undefined ? undefined : patch.title,
      description: patch.description === undefined ? undefined : patch.description,
    })
    .eq("id", id)
    .select(SELECT_COLS)
    .single();
  if (error || !data) throw error ?? new Error("Failed to update document");
  return mapRow(data as unknown as RawRow);
}

export async function deleteDocument(id: string): Promise<void> {
  const { data, error } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", id)
    .single();
  if (error || !data) throw error ?? new Error("Failed to fetch document path");
  const storagePath = (data as { storage_path: string }).storage_path;
  const { error: storageError } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
  if (storageError) throw storageError;
  const { error: deleteError } = await supabase.from("documents").delete().eq("id", id);
  if (deleteError) throw deleteError;
}

export async function uploadToStorage(userId: string, file: File) {
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const storagePath = `${userId}/${safeName}`;
  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(storagePath, file, { upsert: true });
  if (error) throw error;
  return { storagePath, fileName: safeName };
}

export async function downloadDocument(storagePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(storagePath);
  if (error || !data) throw error ?? new Error("Failed to download file");
  return data;
}

export async function updateTags(id: string, tags: string[]): Promise<void> {
  const { error } = await supabase
    .from("documents")
    .update({ tags })
    .eq("id", id);
  if (error) throw error;
}

export function isSupportedDocumentType(value: string | null): value is DocumentType {
  return value !== null && (DOCUMENT_TYPES as readonly string[]).includes(value);
}

/** Task 16/18: sets or clears a document's type, gating the "Add to personal memory" action and its extraction behaviour. */
export async function updateDocumentType(id: string, type: DocumentType | null): Promise<void> {
  const { error } = await supabase
    .from("documents")
    .update({ type })
    .eq("id", id);
  if (error) throw error;
}

export async function updateAiSummary(id: string, summary: string, points: string[]): Promise<void> {
  const { error } = await supabase
    .from("documents")
    .update({ ai_summary: summary, ai_summary_points: points })
    .eq("id", id);
  if (error) throw error;
}

export async function updateExtractedTasksCount(id: string, count: number): Promise<void> {
  const { error } = await supabase
    .from("documents")
    .update({ extracted_tasks_count: count })
    .eq("id", id);
  if (error) throw error;
}

export async function updateLastOpened(id: string): Promise<void> {
  const { error } = await supabase
    .from("documents")
    .update({ last_opened_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
