-- Document-Sourced Memory, slice 1 (task 16, PO-approved design).
--
-- Adds pgvector-backed chunk storage for documents (resumes in this slice).
-- Idempotent throughout; safe to re-run. NOT applied by this task -- see
-- the task 16 final report: "PRODUCTION MIGRATION READY -- PO
-- AUTHORIZATION REQUIRED".
--
-- Scope of this migration: storage only (A1). Extending
-- personal_memory_records' provenance vocabulary to accept a 'document'
-- source (so extraction candidates can cite these chunks) is a SEPARATE,
-- later-timestamped migration (see 20260811010000_personal_memory_document_provenance.sql)
-- -- kept apart because it touches an already-shipped ADR-0010 table/
-- function, not this slice's new storage.

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- documents.type -- the PO-approved design assumes a document can be
-- identified as a resume ("store in existing documents bucket + documents
-- table (type 'resume')"), but no such column exists on public.documents
-- today (verified: 20251225110000_create_documents_table.sql,
-- 20260530000002_document_ai.sql, 20260530000003_documents_metadata_columns.sql
-- -- none of the three ever added one). Added here as minimal, additive
-- infrastructure this slice genuinely needs (the UI action in B2 is gated
-- on it). Nullable -- every existing/untyped document is unaffected.
-- Deliberately narrow (only 'resume' recognized) rather than an open free
-- string, so a typo can't silently create an unrecognized type; extend the
-- check when a real second type is needed.
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists type text check (type is null or type = 'resume');

create index if not exists documents_type_idx on public.documents (type) where type is not null;

-- ---------------------------------------------------------------------------
-- document_chunks -- one row per section/size-bounded chunk of a document's
-- extracted text, plus its embedding. Written by the Worker (service role)
-- only; read-only for the owning user in the browser (used to resolve a
-- personal-memory candidate's provenance display line -- file name +
-- section_label -- and, in a future slice, retrieval; NOT wired into chat
-- prompts in this slice, per the PO-approved design).
-- ---------------------------------------------------------------------------
create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,

  -- Denormalized from documents.file_name at chunk-write time (never
  -- re-read from documents afterward). Needed for two things: the UI's
  -- source line (avoids a second join), and -- the reason it is NOT
  -- optional -- Phase B's snapshot-on-delete trigger (see
  -- 20260811010000_personal_memory_document_provenance.sql), which must
  -- read it from OLD.file_name inside a BEFORE DELETE trigger that also
  -- fires during a documents-row CASCADE. At that point the parent
  -- documents row is already gone from this transaction's own view (an
  -- ON DELETE CASCADE's child deletion runs after the parent row's own
  -- delete within the same statement), so a cross-table lookup back to
  -- documents.file_name would silently return nothing precisely in the
  -- one case (document hard-delete) the snapshot most needs to survive.
  file_name text not null check (char_length(file_name) between 1 and 255),

  chunk_index integer not null check (chunk_index >= 0),

  -- Free text: a recognized section header ("Experience", "Education",
  -- "Skills", their DE equivalents) when section-heuristic chunking found
  -- one, or a synthetic label ("Part 3") for the size-based fallback.
  -- Never null -- the UI's source line always has something to show.
  section_label text not null check (char_length(section_label) between 1 and 100),

  -- Bounded to the same per-chunk cap the Worker enforces when it writes
  -- these rows (agent/worker/document-memory-extraction-endpoint.ts's
  -- MAX_CHUNK_CHARS) -- this CHECK is the database's own independent
  -- backstop, not the primary enforcement point.
  content text not null check (char_length(content) between 1 and 4000),

  -- M2 (PO amendment to task 16, decision 1): provenance honesty --
  -- records HOW this chunk's text was obtained, so a downstream consumer
  -- (the personal-memory candidate's source line) can be honest about it
  -- rather than laundering a model transcription as if it were a native
  -- text-layer extraction. Slice 1 only ever writes 'model_transcription'
  -- (PDF bytes sent to Gemini, asked to return the verbatim plain text --
  -- see the task 16 report's decision 1 amendment); a future slice adding
  -- native PDF text-layer extraction would write a different value here,
  -- and this column is what lets that slice tell the two apart without a
  -- backfill.
  extraction_method text not null check (extraction_method in ('model_transcription')),

  -- text-embedding-004, 768 dimensions (task 16 report's Phase-A decision
  -- 2: Gemini's stable embedding model, same generativelanguage.googleapis.com
  -- host already used for generation elsewhere in this Worker; 768 keeps
  -- the HNSW index below reasonably cheap).
  embedding vector(768) not null,

  created_at timestamptz not null default now()
);

create index if not exists document_chunks_document_id_idx
  on public.document_chunks (document_id);
create index if not exists document_chunks_user_id_idx
  on public.document_chunks (user_id);

-- One embedding column, one distance function (cosine -- the standard
-- choice for text-embedding-004, whose vectors are not unit-length-invariant
-- under inner product the way some embedding models' are, and whose
-- documented similarity metric is cosine). HNSW over ivfflat: this table
-- starts empty and grows incrementally per user action (an "Extract to
-- personal memory" click), never via a single bulk load -- ivfflat's list
-- count is chosen at index-build time from an assumed row count and needs
-- periodic REINDEX to stay effective as a table grows well past that
-- assumption; HNSW has no such build-time sizing decision and degrades
-- more gracefully for this exact incremental-growth pattern. Retrieval
-- itself is out of scope for this slice (PO-approved design: "NOT wired
-- into chat prompts in this slice") -- this index exists so a future
-- retrieval slice does not need its own migration to add it.
create index if not exists document_chunks_embedding_hnsw_idx
  on public.document_chunks
  using hnsw (embedding vector_cosine_ops);

alter table public.document_chunks enable row level security;

-- Owner-only select for the browser; ALL writes are Worker service-role
-- only (mirrors document_evidence/inferred_context's posture for
-- Worker-populated tables) -- a browser client can never insert a chunk
-- with an embedding it didn't pay to compute, and never edit or delete one
-- directly. Document deletion (documentsService.ts's existing
-- deleteDocument, unchanged by this task) cascades chunk deletion via the
-- document_id FK's ON DELETE CASCADE above -- verified against the real
-- delete path: it performs a genuine row DELETE, not a soft-flag, so the
-- CASCADE fires.
revoke insert, update, delete on public.document_chunks from authenticated, anon;
grant select on public.document_chunks to authenticated;
grant select, insert, update, delete on public.document_chunks to service_role;

drop policy if exists "Users can read own document chunks" on public.document_chunks;
create policy "Users can read own document chunks"
  on public.document_chunks
  for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.document_chunks is
  'Document-Sourced Memory slice 1 (task 16): section/size-bounded chunks of a document''s extracted text plus their embedding. Worker-written (service role) only; owner-only read. Not wired into chat retrieval in this slice -- extraction-only.';
