-- Document-Sourced Memory, slice 2 (task 18), Phase A1.
--
-- Widens two CHECK constraints slice 1 (task 16) deliberately left narrow:
--
-- 1. documents.type -- was ('resume' | null) only. Slice 2's PO decision:
--    feed financial statements, personal documents, and business documents
--    into personal memory through the SAME "Add to personal memory" flow,
--    not a resume-only action. Widened to
--    ('resume' | 'financial' | 'personal' | 'business' | null) -- NULL
--    remains allowed for every untyped document, unchanged.
-- 2. document_chunks.extraction_method -- was ('model_transcription') only,
--    a single-value CHECK that existed purely for provenance-honesty
--    forward-compatibility (see that column's own original comment: "a
--    future slice adding native PDF text-layer extraction would write a
--    different value here"). This slice is that future slice, for a
--    narrower case: a plain-text (.txt) document never needs a model
--    transcription step at all -- its bytes ARE the text. Widened to add
--    'native_text', used only for text/plain documents (see
--    agent/worker/document-memory-extraction-endpoint.ts's own branch).
--
-- Idempotent throughout (drop-if-exists + add), safe to re-run, safe to
-- replay on a clean shadow DB either before or after 20260811000000/
-- 20260811010000 have been applied. NOT applied by this task -- see the
-- task 18 final report: "PRODUCTION MIGRATION READY -- PO AUTHORIZATION
-- REQUIRED".
--
-- No src/integrations/supabase/types.ts delta is needed for either change:
-- both columns are already hand-typed as plain `string`/`string | null`
-- (never as a narrow literal union), so widening the CHECK's *set* of
-- accepted values requires no corresponding TypeScript change -- verified
-- by reading the current file (types.ts:218,517,541,565 for `type`;
-- types.ts:457,469,481 for `extraction_method`).

-- ---------------------------------------------------------------------------
-- documents.type
-- ---------------------------------------------------------------------------
alter table public.documents
  drop constraint if exists documents_type_check;
alter table public.documents
  add constraint documents_type_check
  check (type is null or type in ('resume', 'financial', 'personal', 'business'));

comment on column public.documents.type is
  'Task 16/18: user-assigned document type gating the "Add to personal memory" action and its extraction behaviour. NULL = untyped (no action shown). One of resume|financial|personal|business once set.';

-- ---------------------------------------------------------------------------
-- document_chunks.extraction_method
-- ---------------------------------------------------------------------------
alter table public.document_chunks
  drop constraint if exists document_chunks_extraction_method_check;
alter table public.document_chunks
  add constraint document_chunks_extraction_method_check
  check (extraction_method in ('model_transcription', 'native_text'));

comment on column public.document_chunks.extraction_method is
  'Task 16/18: how this chunk''s text was obtained. model_transcription = PDF bytes sent to Gemini and transcribed verbatim (provenance is honest about being a model reading, not a native text-layer read). native_text = the source document was already plain text (e.g. a .txt statement) and its bytes were read directly -- no model call, more honest provenance, and cannot itself introduce a transcription error.';
