-- Document-Sourced Memory, slice 1 (task 16) -- Phase B1.
--
-- Extends ADR-0010's already-shipped personal_memory_records
-- (20260808000000_personal_memory_records.sql) to accept 'document' as a
-- third provenance_source_kind, with ref_ids pointing at
-- document_chunks.id (not documents.id -- per-chunk precision, matching
-- how 'chat_turn'/'briefing' already reference the specific message/
-- briefing row, not some coarser grouping).
--
-- Also implements the Phase-B amendment (PO/architect): re-extraction's
-- delete-before-insert (document-memory-extraction-endpoint.ts) and a
-- document hard-delete (documentsService.ts's deleteDocument, via
-- document_chunks' own ON DELETE CASCADE) both remove document_chunks rows
-- that a CONFIRMED personal_memory_record may still cite. A
-- BEFORE DELETE trigger on document_chunks snapshots (file_name,
-- section_label, a <=200-char content excerpt) onto any referencing
-- record before the chunk disappears -- this is the ONLY mechanism that
-- can cover the document-hard-delete path: that deletion happens entirely
-- browser-side via RLS (documentsService.ts's deleteDocument does a plain
-- `.from("documents").delete()`), with the CASCADE executing at the
-- database level with zero Worker/application code involved. A
-- BEFORE DELETE trigger on document_chunks itself is the only code that
-- reliably runs for both the Worker's explicit re-extraction DELETE and
-- the CASCADE-driven delete, since both are, at the row level, simply "a
-- DELETE executed against document_chunks".
--
-- Idempotent throughout; safe to re-run. NOT applied by this task -- see
-- the task 16 final report.

-- ---------------------------------------------------------------------------
-- provenance_source_kind: widen the CHECK to add 'document'. The column
-- was declared with an unnamed (Postgres-auto-named) CHECK constraint in
-- the original migration; Postgres's deterministic default name for an
-- unnamed single-column CHECK is `<table>_<column>_check`, exactly as
-- task 15's reconciliation migration already relied on for other
-- Postgres-auto-named constraints (e.g. user_settings_pkey).
-- ---------------------------------------------------------------------------
alter table public.personal_memory_records
  drop constraint if exists personal_memory_records_provenance_source_kind_check;
alter table public.personal_memory_records
  add constraint personal_memory_records_provenance_source_kind_check
  check (provenance_source_kind in ('chat_turn', 'briefing', 'explicit_user_statement', 'document'));

-- ---------------------------------------------------------------------------
-- provenance_snapshot (Phase-B amendment): a JSON array of
-- { chunkId, fileName, sectionLabel, contentExcerpt } entries, one per
-- cited chunk that has since been deleted (re-extraction or document
-- hard-delete). Null / empty for every record whose cited chunks are still
-- live -- the UI's source line reads the live document_chunks join first
-- and only falls back to this column when that join misses an id. Written
-- ONLY by the trigger below (and, transitively, by
-- create_personal_memory_record/resolve_personal_memory_record leaving it
-- untouched at insert time -- both already omit unmentioned columns,
-- which default to null here). This is user-confirmation metadata, not
-- document data: per ADR-0010's hard-delete guarantee ("forget means
-- forget" governs personal_memory_records rows themselves, not the
-- provenance breadcrumb of a still-existing confirmed fact), it correctly
-- survives the source document's own deletion.
-- ---------------------------------------------------------------------------
alter table public.personal_memory_records
  add column if not exists provenance_snapshot jsonb;

alter table public.personal_memory_records
  drop constraint if exists personal_memory_records_provenance_snapshot_check;
alter table public.personal_memory_records
  add constraint personal_memory_records_provenance_snapshot_check
  check (provenance_snapshot is null or jsonb_typeof(provenance_snapshot) = 'array');

-- ---------------------------------------------------------------------------
-- create_personal_memory_record: CREATE OR REPLACE is naturally idempotent
-- -- this is the full function body from the original migration with two
-- changes: (1) the "unsupported kind" gate now allows 'document' alongside
-- 'chat_turn'/'briefing'; (2) a third membership-check branch verifies
-- 'document' ref_ids against document_chunks (owned by this same user),
-- the same defense-in-depth pattern the other two branches already use.
-- ---------------------------------------------------------------------------
create or replace function public.create_personal_memory_record(
  p_run_id uuid,
  p_kind text,
  p_content jsonb,
  p_provenance_source_kind text,
  p_provenance_source_ref_ids uuid[],
  p_model_identity text,
  p_derivation_version text,
  p_confidence text,
  p_content_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_run record;
  v_ref_count integer;
  v_new_id uuid;
  v_new_row public.personal_memory_records;
  v_existing public.personal_memory_records;
  v_constraint_name text;
begin
  v_owner_id := auth.uid();
  if v_owner_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  -- No project ownership/archive check -- this table has no project
  -- dimension at all (ADR-0010 Decision section 1).

  -- The run record must belong to this same owner -- a Worker bug or a
  -- forged run_id must not be able to attach a record to a run it does not
  -- own.
  select 1 into v_run
    from public.personal_memory_extraction_runs r
    where r.id = p_run_id and r.user_id = v_owner_id;
  if not found then
    raise exception 'RUN_NOT_FOUND';
  end if;

  -- explicit_user_statement has no capture surface yet (ADR-0010 section
  -- 2.b) and therefore no table this function can verify membership
  -- against -- reject it here rather than silently accepting an
  -- unverifiable reference. The column CHECK still allows the value for
  -- forward compatibility with ADR-0010's own data model; this function is
  -- deliberately narrower than the column today. 'document' (task 16) is
  -- the one addition beyond the original two.
  if p_provenance_source_kind not in ('chat_turn', 'briefing', 'document') then
    raise exception 'UNSUPPORTED_PROVENANCE_SOURCE_KIND';
  end if;

  -- ADR-0010 section 2.b: reference-only provenance, verified the same way
  -- create_inferred_context_field verifies source_evidence_ids membership
  -- -- every referenced id must be real, owned by this exact user.
  if p_provenance_source_kind = 'chat_turn' then
    select count(*) into v_ref_count
      from public.agent_chat_messages m
      where m.id = any(p_provenance_source_ref_ids) and m.user_id = v_owner_id;
  elsif p_provenance_source_kind = 'document' then
    -- task 16: ref ids point at document_chunks.id (per-chunk precision),
    -- not documents.id -- see this migration's own header comment.
    select count(*) into v_ref_count
      from public.document_chunks c
      where c.id = any(p_provenance_source_ref_ids) and c.user_id = v_owner_id;
  else
    select count(*) into v_ref_count
      from public.agent_briefings b
      where b.id = any(p_provenance_source_ref_ids) and b.user_id = v_owner_id;
  end if;
  if v_ref_count <> cardinality(p_provenance_source_ref_ids) then
    raise exception 'SOURCE_REFERENCE_NOT_FOUND';
  end if;

  -- Duplicate-suppression (ADR-0010 citing ADR-0009 Q1/Q5): a
  -- non-superseded row with the identical fingerprint already exists for
  -- this user+kind -- return it rather than creating a second one. Fast-path
  -- only; the exception handler around the INSERT below is what makes the
  -- race itself safe (identical structure to
  -- create_inferred_context_field's own F3 remediation, built in from the
  -- start this time rather than added after a review finding).
  select * into v_existing
    from public.personal_memory_records
    where user_id = v_owner_id and kind = p_kind and content_fingerprint = p_content_fingerprint
      and status <> 'superseded'
    limit 1;
  if found then
    return jsonb_build_object('outcome', 'duplicate_suppressed', 'field', to_jsonb(v_existing));
  end if;

  v_new_id := gen_random_uuid();

  -- No automatic supersession in v1, for ANY kind -- documented decision,
  -- not an oversight (see original migration's comment for the full
  -- rationale, unchanged here).
  begin
    insert into public.personal_memory_records (
      id, user_id, run_id, kind, content, provenance_source_kind, provenance_source_ref_ids,
      model_identity, derivation_version, confidence, status, source, supersedes_id, content_fingerprint
    ) values (
      v_new_id, v_owner_id, p_run_id, p_kind, p_content, p_provenance_source_kind, p_provenance_source_ref_ids,
      p_model_identity, p_derivation_version, p_confidence, 'proposed', 'model', null, p_content_fingerprint
    )
    returning * into v_new_row;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name <> 'personal_memory_records_fingerprint_key' then
        raise;
      end if;

      select * into v_existing
        from public.personal_memory_records
        where user_id = v_owner_id and kind = p_kind and content_fingerprint = p_content_fingerprint
          and status <> 'superseded'
        limit 1;
      if v_existing.id is null then
        raise exception 'DUPLICATE_LOOKUP_FAILED';
      end if;
      return jsonb_build_object('outcome', 'duplicate_suppressed', 'field', to_jsonb(v_existing));
  end;

  return jsonb_build_object('outcome', 'created', 'field', to_jsonb(v_new_row));
end;
$$;

comment on function public.create_personal_memory_record is
  'ADR-0010 + task 16: the sole path for persisting a model-authored PersonalMemoryRecord candidate. Must be called with the requesting user''s own JWT (never service-role). Race-safe duplicate-suppression built in from the start. Accepts chat_turn/briefing/document provenance.';

revoke all on function public.create_personal_memory_record(
  uuid, text, jsonb, text, uuid[], text, text, text, text
) from public;
grant execute on function public.create_personal_memory_record(
  uuid, text, jsonb, text, uuid[], text, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- snapshot_document_chunk_provenance: BEFORE DELETE trigger on
-- document_chunks. SECURITY DEFINER because it must succeed regardless of
-- which role's statement ultimately caused the delete -- an authenticated
-- user's own `DELETE FROM documents` (RLS-permitted, cascading into this
-- table) has no direct UPDATE grant on personal_memory_records (revoked
-- from authenticated by the original migration), and must not need one
-- just to let this snapshot happen.
--
-- Appends (never overwrites) one snapshot entry per matching record, and
-- is defensively idempotent against being invoked more than once for the
-- same (record, chunk) pair (a chunk row can only be deleted once in
-- reality, but this keeps the function safe if that ever changed).
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_document_chunk_provenance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.personal_memory_records
  set provenance_snapshot = coalesce(provenance_snapshot, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'chunkId', old.id,
      'fileName', old.file_name,
      'sectionLabel', old.section_label,
      'contentExcerpt', left(old.content, 200)
    )
  )
  where provenance_source_kind = 'document'
    and old.id = any(provenance_source_ref_ids)
    and not exists (
      select 1
        from jsonb_array_elements(coalesce(personal_memory_records.provenance_snapshot, '[]'::jsonb)) as elem
        where elem ->> 'chunkId' = old.id::text
    );
  return old;
end;
$$;

comment on function public.snapshot_document_chunk_provenance is
  'Task 16 Phase-B amendment: before a document_chunks row is deleted (Worker re-extraction OR a documents-row CASCADE from a hard delete), snapshot (fileName, sectionLabel, a <=200-char content excerpt) onto every personal_memory_records row that still cites it, so the UI source line has a fallback once the live chunk is gone.';

drop trigger if exists snapshot_document_chunk_provenance_trigger on public.document_chunks;
create trigger snapshot_document_chunk_provenance_trigger
  before delete on public.document_chunks
  for each row
  execute function public.snapshot_document_chunk_provenance();
