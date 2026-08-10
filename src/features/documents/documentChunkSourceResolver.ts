// SmartFlow -- Document-Sourced Memory, slice 1 (task 16). Resolves the
// live source-display info (file name, section label) for a set of
// document_chunks ids -- used by PersonalMemorySection.tsx to build a
// document-sourced candidate's source line. Read-only, RLS-scoped (owner
// only, per 20260811000000_document_chunks_pgvector.sql's grant to
// authenticated); a chunk id that has since been deleted (re-extraction or
// a document hard-delete) simply does not appear in the returned map --
// the caller falls back to the record's own provenance_snapshot for that
// id (see 20260811010000_personal_memory_document_provenance.sql's
// snapshot trigger).

import { supabase } from "@/integrations/supabase/client";

export interface DocumentChunkSource {
  readonly fileName: string;
  readonly sectionLabel: string;
}

export type ResolveDocumentChunkSources = (chunkIds: readonly string[]) => Promise<Record<string, DocumentChunkSource>>;

export const resolveDocumentChunkSources: ResolveDocumentChunkSources = async (chunkIds) => {
  const uniqueIds = [...new Set(chunkIds)];
  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from("document_chunks")
    .select("id,file_name,section_label")
    .in("id", uniqueIds);
  if (error) throw error;

  const result: Record<string, DocumentChunkSource> = {};
  for (const row of (data ?? []) as Array<{ id: string; file_name: string; section_label: string }>) {
    result[row.id] = { fileName: row.file_name, sectionLabel: row.section_label };
  }
  return result;
};
