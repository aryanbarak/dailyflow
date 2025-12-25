import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

const BUCKET = "user-documents";

export interface Document {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  title: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];

function mapRow(row: DocumentRow): Document {
  return {
    id: row.id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDocuments(): Promise<Document[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id,storage_path,file_name,mime_type,size_bytes,title,description,created_at,updated_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => mapRow(row as DocumentRow));
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
    .select("id,storage_path,file_name,mime_type,size_bytes,title,description,created_at,updated_at")
    .single();
  if (error || !data) throw error ?? new Error("Failed to create document");
  return mapRow(data as DocumentRow);
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
    .select("id,storage_path,file_name,mime_type,size_bytes,title,description,created_at,updated_at")
    .single();
  if (error || !data) throw error ?? new Error("Failed to update document");
  return mapRow(data as DocumentRow);
}

export async function deleteDocument(id: string): Promise<void> {
  const { data, error } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", id)
    .single();
  if (error || !data) throw error ?? new Error("Failed to fetch document path");
  const storagePath = (data as { storage_path: string }).storage_path;
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (storageError) throw storageError;
  const { error: deleteError } = await supabase.from("documents").delete().eq("id", id);
  if (deleteError) throw deleteError;
}

export async function uploadToStorage(userId: string, file: File) {
  const safeName = `${Date.now()}_${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  const storagePath = `${userId}/${safeName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file, { upsert: false });
  if (error) throw error;
  return {
    storagePath,
    fileName: safeName,
  };
}

export async function downloadDocument(storagePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !data) throw error ?? new Error("Failed to download file");
  return data;
}
