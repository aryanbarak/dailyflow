-- ADR-0010: Personal Memory Layer v1.
--
-- Extends ADR-0009's proven InferredProjectContextField pattern from the
-- project dimension to the person dimension. Mirrors that migration's
-- structure exactly except where ADR-0010's Product Owner Resolutions
-- require a difference -- every difference is called out explicitly below
-- rather than silently copied or silently changed.
--
-- Two tables:
--   personal_memory_extraction_runs -- one row per extraction attempt,
--     user-scoped (no project dimension at all). Ordinary owner-scoped RLS,
--     no SECURITY DEFINER needed, exactly like
--     inferred_context_derivation_runs.
--   personal_memory_records -- one row per candidate personal-memory fact
--     (kind: preference | goal | working_pattern | commitment |
--     personal_fact | skill -- ADR-0010 Product Owner Resolution Q2).
--     Immutable once created; all writes go through three SECURITY DEFINER
--     functions below. Two of the three (create/resolve) mirror
--     create_inferred_context_field/resolve_inferred_context_field almost
--     exactly; the third (delete) has no ADR-0009 analogue at all -- it
--     exists because ADR-0010 Q1 requires a real, immediate hard-delete
--     erasure path for personal data that ADR-0009 Q1 deliberately deferred
--     for project data.
--
-- Nothing in this migration touches user_context, agent_chat_messages,
-- agent_briefings, or any other existing table. Per ADR-0010 Q3
-- (supersede), user_context's own write paths are disabled in application
-- code (agent/worker/index.ts), not by any schema change here -- the table
-- and its existing rows remain exactly as they are; existing consumers keep
-- reading it unchanged until they migrate.

create table if not exists public.personal_memory_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- No project_id -- ADR-0010 Decision section 1: "user-scoped (no project
  -- dimension)". This is the one structural difference from
  -- inferred_context_derivation_runs present on every column below too.
  model_identity text not null check (char_length(model_identity) between 1 and 200),
  derivation_version text not null check (char_length(derivation_version) between 1 and 100),

  -- ADR-0010 Decision section 4 cites ADR-0009 Q3's resolution directly:
  -- minimal cost visibility only, no dashboard.
  started_at timestamptz not null,
  completed_at timestamptz,
  prompt_token_count integer check (prompt_token_count is null or prompt_token_count >= 0),
  response_token_count integer check (response_token_count is null or response_token_count >= 0),

  candidate_count integer not null default 0 check (candidate_count >= 0),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  dropped_count integer not null default 0 check (dropped_count >= 0),

  outcome text check (outcome is null or outcome in ('completed', 'failed')),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),

  created_at timestamptz not null default now()
);

create index if not exists personal_memory_extraction_runs_user_id_idx
  on public.personal_memory_extraction_runs (user_id);

alter table public.personal_memory_extraction_runs enable row level security;

-- Same reasoning as inferred_context_derivation_runs: a run's own lifecycle
-- is ordinary mutable operational metadata, not a conclusion about the
-- user -- no SECURITY DEFINER function is needed for this table.
drop policy if exists "Users can read own extraction runs" on public.personal_memory_extraction_runs;
create policy "Users can read own extraction runs"
  on public.personal_memory_extraction_runs
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create own extraction runs" on public.personal_memory_extraction_runs;
create policy "Users can create own extraction runs"
  on public.personal_memory_extraction_runs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own extraction runs" on public.personal_memory_extraction_runs;
create policy "Users can update own extraction runs"
  on public.personal_memory_extraction_runs
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.personal_memory_extraction_runs to authenticated;
grant select, insert, update, delete on public.personal_memory_extraction_runs to service_role;

comment on table public.personal_memory_extraction_runs is
  'ADR-0010: one row per Personal Memory extraction attempt. Run-level metadata only -- never the candidate content itself, which lives in personal_memory_records. User-scoped, no project dimension.';

-- ---------------------------------------------------------------------------

create table if not exists public.personal_memory_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Nullable: required for source='model' rows, always null for
  -- source='user' rows -- identical rule to
  -- inferred_project_context_fields_run_id_matches_source, enforced by the
  -- constraint below.
  run_id uuid references public.personal_memory_extraction_runs(id) on delete cascade,

  -- ADR-0010 Product Owner Resolution Q2: exactly six kinds. health,
  -- relationships/family, and emotional-state are deliberately NOT in this
  -- list -- the PO explicitly accepted removing the live
  -- health_note/family_note extraction capability (see
  -- agent/worker/prompt-builder.ts's EXTRACTABLE_KEYS, which this migration
  -- does not touch but whose two sensitive keys the Worker route built on
  -- this schema must never populate).
  kind text not null check (kind in ('preference', 'goal', 'working_pattern', 'commitment', 'personal_fact', 'skill')),

  -- Structured, per-kind payload -- deterministic validation lives in
  -- application code (src/features/projects/personalMemoryRecordValidation.ts),
  -- exactly as inferred_project_context_fields.content already documents
  -- for the identical reason: the single source of truth is the TypeScript
  -- validator, not a kind-conditional jsonb schema duplicated in SQL.
  content jsonb not null check (char_length(content::text) <= 8192),

  -- ADR-0010 Decision section 1: provenance.sourceKind + non-empty
  -- provenance.sourceReferenceIds, "MUST be non-empty" -- mirrors ADR-0009's
  -- "an inference with no evidence linkage is invalid by construction"
  -- exactly, one layer up. Three source kinds per ADR-0010 section 2.b;
  -- 'explicit_user_statement' is included in this CHECK for schema
  -- forward-compatibility with ADR-0010's own data model, but no RPC in
  -- this migration/task populates it -- explicit user statements have no
  -- capture surface yet (ADR-0010 section 2.b: "out of scope for this
  -- ADR's implementation task"). create_personal_memory_record below
  -- rejects it with UNSUPPORTED_PROVENANCE_SOURCE_KIND until a future task
  -- builds that capture path and can populate meaningful reference ids.
  provenance_source_kind text not null check (provenance_source_kind in ('chat_turn', 'briefing', 'explicit_user_statement')),

  -- Reference-only (ADR-0010 section 2.b's recommendation): these ids point
  -- at agent_chat_messages.id or agent_briefings.id depending on
  -- provenance_source_kind, never a copy of the raw source text. No
  -- database-level FK is declared here because the target table is
  -- conditional on provenance_source_kind (a single column cannot FK to
  -- two different tables) -- membership is verified inside
  -- create_personal_memory_record instead, the same defense-in-depth
  -- pattern create_inferred_context_field already applies to
  -- source_evidence_ids.
  --
  -- Caveat, documented per ADR-0010 section 2.b: agent_chat_messages is
  -- pruned to the most recent 100 rows per user on every insert
  -- (20260616000000_agent_chat_messages_cap.sql). A provenance reference
  -- here is therefore NOT permanently resolvable the way a
  -- project_evidence reference is -- a personal_memory_records row can
  -- outlive the chat turn it cites. This is an accepted consequence of
  -- reference-only provenance for a bounded-retention source, not a defect.
  provenance_source_ref_ids uuid[] not null check (cardinality(provenance_source_ref_ids) >= 1 and cardinality(provenance_source_ref_ids) <= 20),

  -- NOT NULL on both, mirroring inferred_project_context_fields exactly --
  -- ADR-0009's resolve_inferred_context_field correction path does not set
  -- these to null for a source='user' row, it sets sentinel string values
  -- ('user' / 'user-correction-v1'); resolve_personal_memory_record below
  -- does the identical thing for the identical reason (a single NOT NULL
  -- column family, no nullable-for-one-source special case to test around).
  model_identity text not null check (char_length(model_identity) between 1 and 200),
  derivation_version text not null check (char_length(derivation_version) between 1 and 100),

  -- Same closed three-value scale as ADR-0009, cited not restated
  -- (ADR-0010 Decision section 1).
  confidence text not null check (confidence in ('low', 'medium', 'high')),

  status text not null default 'proposed'
    check (status in ('proposed', 'user_confirmed', 'user_corrected', 'user_rejected', 'superseded')),

  source text not null check (source in ('model', 'user')),

  -- Self-referencing, nullable. Unlike inferred_project_context_fields,
  -- this FK is ON DELETE SET NULL rather than the implicit NO ACTION --
  -- required by ADR-0010 Q1's "hard delete of any record at any status, no
  -- exceptions": if a user hard-deletes the original model row a later
  -- correction's supersedes_id points at, the correction row must remain
  -- deletable-independent and must not block or cascade from that delete.
  -- The correction row survives with supersedes_id nulled out -- it loses
  -- the "this was a correction of X" lineage once X is gone, which is the
  -- accepted, correctly-scoped consequence of a real hard delete, not a
  -- defect (see delete_personal_memory_record below).
  supersedes_id uuid references public.personal_memory_records(id) on delete set null,

  -- Deterministic SHA-256 over (kind, normalized content) only -- NOT
  -- user_id (review finding MINOR, 2026-08-personal-memory-layer-review.md:
  -- an earlier version of this comment overclaimed user_id was part of the
  -- hash input; computePersonalMemoryContentFingerprint's actual signature
  -- is (kind, content), mirroring computeInferredFieldContentFingerprint's
  -- own (kind, content)-only hash exactly). This is not a cross-user
  -- collision risk: the partial unique index below adds user_id as a
  -- separate index column, so uniqueness is still scoped per-user at the
  -- database layer regardless of what the hash itself covers. Computed
  -- identically in application code (computePersonalMemoryContentFingerprint
  -- in personalMemoryRecordValidation.ts, mirrored in the Worker's own
  -- extraction route since agent/worker cannot import frontend modules).
  -- Drives this table's Q1/Q5-style duplicate-suppression rule (ADR-0010
  -- cites ADR-0009 Q1/Q5's logic directly), including against previously
  -- user_rejected rows -- BUT NOT against deleted rows, which is the point
  -- of Q1: a deleted row's fingerprint no longer occupies the partial
  -- unique index below at all, so a later, honest re-extraction of the
  -- same fact after deletion is not blocked. "Forget means forget."
  content_fingerprint text not null check (content_fingerprint ~ '^[0-9a-f]{64}$'),

  created_at timestamptz not null default now(),

  constraint personal_memory_records_run_id_matches_source
    check ((source = 'model' and run_id is not null) or (source = 'user' and run_id is null))
);

-- Duplicate-suppression scope: (user_id, kind, content_fingerprint) --
-- NO project_id dimension (there is none for this table), unlike
-- inferred_project_context_fields_fingerprint_key's (project_id, kind,
-- content_fingerprint) scope. Partial over status <> 'superseded', for the
-- identical reason ADR-0009's own index documents: a superseded row is
-- explicitly allowed to share a fingerprint with a fresh proposal again
-- later. Critically for ADR-0010 Q1: this index only constrains rows that
-- CURRENTLY EXIST. delete_personal_memory_record's hard DELETE removes the
-- row entirely, which removes it from this index by construction -- no
-- separate "clear the suppression" step is needed, and none exists. This is
-- the verification ADR-0010 Q1 and the implementation task both asked for:
-- deletion's effect on duplicate-suppression is automatic, falling directly
-- out of using a live index over current rows rather than a separate
-- append-only suppression ledger.
create unique index if not exists personal_memory_records_fingerprint_key
  on public.personal_memory_records (user_id, kind, content_fingerprint)
  where status <> 'superseded';

create index if not exists personal_memory_records_user_id_idx
  on public.personal_memory_records (user_id);
create index if not exists personal_memory_records_run_id_idx
  on public.personal_memory_records (run_id);
create index if not exists personal_memory_records_user_kind_status_idx
  on public.personal_memory_records (user_id, kind, status);

alter table public.personal_memory_records enable row level security;

-- No insert/update/delete policy for authenticated at all -- exactly
-- ProjectEvidence's and inferred_project_context_fields' posture. The only
-- three write paths are the SECURITY DEFINER functions below; direct
-- client INSERT/UPDATE/DELETE is revoked. This is a deliberate, explicit
-- break from user_context's current bare-RLS-GRANT-ALL posture (ADR-0010's
-- Problem section documents exactly why that posture is inadequate for a
-- table an LLM writes to).
revoke insert, update, delete on public.personal_memory_records from authenticated, anon;
grant select on public.personal_memory_records to authenticated;
grant select, insert, update, delete on public.personal_memory_records to service_role;

drop policy if exists "Users can read own personal memory records" on public.personal_memory_records;
create policy "Users can read own personal memory records"
  on public.personal_memory_records
  for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.personal_memory_records is
  'ADR-0010: one row per candidate personal-memory fact (preference|goal|working_pattern|commitment|personal_fact|skill), never itself canonical truth. Immutable once created -- no update path. Writes only via create_personal_memory_record / resolve_personal_memory_record / delete_personal_memory_record. User-scoped, no project dimension.';

-- ---------------------------------------------------------------------------
-- create_personal_memory_record: the sole path for persisting a
-- model-authored candidate. Called from the Worker's Personal Memory
-- extraction route with the requesting user's own JWT forwarded (never
-- service-role), per ADR-0010 Decision section 4 citing ADR-0009's
-- context-derivation posture directly -- so auth.uid() below resolves to
-- the real user.
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
  -- deliberately narrower than the column today.
  if p_provenance_source_kind not in ('chat_turn', 'briefing') then
    raise exception 'UNSUPPORTED_PROVENANCE_SOURCE_KIND';
  end if;

  -- ADR-0010 section 2.b: reference-only provenance, verified the same way
  -- create_inferred_context_field verifies source_evidence_ids membership
  -- -- every referenced id must be real, owned by this exact user.
  if p_provenance_source_kind = 'chat_turn' then
    select count(*) into v_ref_count
      from public.agent_chat_messages m
      where m.id = any(p_provenance_source_ref_ids) and m.user_id = v_owner_id;
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
  -- not an oversight. ADR-0009's own automatic supersession is narrowly
  -- scoped to objective/milestone specifically BECAUSE
  -- ProjectContextBuilder independently enforces "at most one active
  -- objective" / "at most one active milestone"
  -- (project-domain.md section 8) -- a real downstream single-slot rule
  -- that makes "supersede the old one" the correct behavior rather than an
  -- invented merge. No personal-memory kind has an analogous "at most one
  -- active X" rule anywhere in this codebase: a person can plausibly hold
  -- multiple simultaneous preferences, goals, working patterns,
  -- commitments, personal facts, or skills at once, exactly as
  -- decision/risk/capability/candidate_action were left to coexist in
  -- ADR-0009's own Implementation Notes for the identical reason.
  -- Inventing a slot concept here (e.g. "the current goal") with no
  -- existing validator to justify it would risk exactly what ADR-0009's
  -- Implementation Notes warned against: wrongly discarding a legitimate
  -- second, unrelated candidate. Deduplication is therefore limited to
  -- exact-content-fingerprint matching (above) for v1; the 'superseded'
  -- status remains in the vocabulary for schema symmetry with ADR-0009 and
  -- to leave room for a future, explicitly-decided per-kind slot rule, but
  -- no code path in this migration ever sets it.
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
      -- Race-safe from the start (the pattern ADR-0009 only added after
      -- review finding F3): identify the ACTUAL violated constraint via
      -- the exception's own diagnostics before treating it as the benign
      -- fingerprint-duplicate case.
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name <> 'personal_memory_records_fingerprint_key' then
        raise;
      end if;

      -- Lost the race: a concurrent call with the identical
      -- (user_id, kind, content_fingerprint) committed first. Same outcome
      -- a strictly-sequential second call would have received from the
      -- SELECT check above -- never persistence_failed, never a raw error
      -- propagated to the Worker. Fail closed if the row this violation
      -- implies exists cannot actually be found: default READ COMMITTED
      -- isolation is guaranteed to see the now-committed winner, so a
      -- lookup miss here indicates a genuine inconsistency, not a timing
      -- artifact.
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
  'ADR-0010: the sole path for persisting a model-authored PersonalMemoryRecord candidate. Must be called with the requesting user''s own JWT (never service-role). Race-safe duplicate-suppression built in from the start. No automatic supersession for any kind in v1 (documented decision, see function body).';

revoke all on function public.create_personal_memory_record(
  uuid, text, jsonb, text, uuid[], text, text, text, text
) from public;
grant execute on function public.create_personal_memory_record(
  uuid, text, jsonb, text, uuid[], text, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- resolve_personal_memory_record: the sole path for a user's confirm /
-- correct / reject action on a still-proposed record. Mirrors
-- resolve_inferred_context_field's structure and invariants exactly; see
-- that function's own comments for the full rationale, cited here rather
-- than restated.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_personal_memory_record(
  p_record_id uuid,
  p_action text,
  p_corrected_content jsonb default null,
  p_corrected_content_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_record public.personal_memory_records;
  v_new_id uuid;
  v_new_row public.personal_memory_records;
begin
  v_owner_id := auth.uid();
  if v_owner_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_action not in ('confirm', 'correct', 'reject') then
    raise exception 'UNSUPPORTED_ACTION';
  end if;

  -- Non-disclosure: a missing record and one owned by someone else produce
  -- the identical error.
  select * into v_record
    from public.personal_memory_records
    where id = p_record_id and user_id = v_owner_id;
  if not found then
    raise exception 'RECORD_NOT_FOUND';
  end if;

  if v_record.status <> 'proposed' then
    raise exception 'RECORD_NOT_PROPOSED';
  end if;

  if p_action = 'confirm' then
    update public.personal_memory_records set status = 'user_confirmed' where id = p_record_id;
    select * into v_record from public.personal_memory_records where id = p_record_id;
    return jsonb_build_object('outcome', 'user_confirmed', 'field', to_jsonb(v_record));
  end if;

  if p_action = 'reject' then
    update public.personal_memory_records set status = 'user_rejected' where id = p_record_id;
    select * into v_record from public.personal_memory_records where id = p_record_id;
    return jsonb_build_object('outcome', 'user_rejected', 'field', to_jsonb(v_record));
  end if;

  -- p_action = 'correct': identical mechanism to
  -- resolve_inferred_context_field's own correct path -- the original
  -- row's status becomes user_corrected (content never mutated), a NEW row
  -- is inserted with source='user', status='user_confirmed' directly,
  -- confidence fixed at 'high', model_identity/derivation_version set to
  -- the same sentinel values ('user'/'user-correction-v1') the project
  -- layer already uses (NOT NULL columns, no nullable-for-user-rows special
  -- case). Provenance is INHERITED from the original record -- a
  -- correction is a correction of a specific claim made from specific
  -- source material, not a fresh, independently-sourced fact.
  if p_corrected_content is null or jsonb_typeof(p_corrected_content) <> 'object' then
    raise exception 'INVALID_CORRECTED_CONTENT';
  end if;
  if char_length(p_corrected_content::text) > 8192 then
    raise exception 'INVALID_CORRECTED_CONTENT';
  end if;
  if p_corrected_content_fingerprint is null or p_corrected_content_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_CORRECTED_CONTENT';
  end if;

  update public.personal_memory_records set status = 'user_corrected' where id = p_record_id;

  -- Same deliberate choice as resolve_inferred_context_field: a collision
  -- on this INSERT raises a raw unique_violation rather than being caught
  -- and reinterpreted as "already applied" -- the collision is genuinely
  -- ambiguous (replayed request vs. an unrelated existing row that happens
  -- to share this fingerprint) and failing loudly is the lower-risk choice.
  v_new_id := gen_random_uuid();
  insert into public.personal_memory_records (
    id, user_id, run_id, kind, content, provenance_source_kind, provenance_source_ref_ids,
    model_identity, derivation_version, confidence, status, source, supersedes_id, content_fingerprint
  ) values (
    v_new_id, v_owner_id, null, v_record.kind, p_corrected_content, v_record.provenance_source_kind, v_record.provenance_source_ref_ids,
    'user', 'user-correction-v1', 'high', 'user_confirmed', 'user', p_record_id, p_corrected_content_fingerprint
  )
  returning * into v_new_row;

  return jsonb_build_object('outcome', 'user_corrected', 'field', to_jsonb(v_new_row));
end;
$$;

comment on function public.resolve_personal_memory_record is
  'ADR-0010: the sole path for a user confirm/correct/reject action on a proposed PersonalMemoryRecord. A correction never mutates the original row''s content -- it inserts a new source=user row (inheriting the original''s provenance) and marks the original user_corrected.';

revoke all on function public.resolve_personal_memory_record(uuid, text, jsonb, text) from public;
grant execute on function public.resolve_personal_memory_record(uuid, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_personal_memory_record: ADR-0010 Q1 -- hard delete of any record
-- regardless of status, no exceptions. Has no ADR-0009 analogue: erasure
-- was explicitly deferred there (Q1: deferred) and is explicitly required
-- here from day one. "Forget means forget" -- duplicate-suppression for
-- the deleted fingerprint ends the moment this function commits, as a
-- direct, automatic consequence of personal_memory_records_fingerprint_key
-- being a live index over currently-existing rows (see that index's own
-- comment above) -- no separate cleanup step exists or is needed.
-- ---------------------------------------------------------------------------
create or replace function public.delete_personal_memory_record(
  p_record_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_deleted_id uuid;
begin
  v_owner_id := auth.uid();
  if v_owner_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  -- No status check at all -- deliberately, per ADR-0010 Q1: "hard delete
  -- of any record regardless of status." Unlike resolve_personal_memory_record,
  -- this function does not require status = 'proposed'; a user_confirmed,
  -- user_corrected, or even user_rejected/superseded row is equally
  -- deletable.
  delete from public.personal_memory_records
    where id = p_record_id and user_id = v_owner_id
    returning id into v_deleted_id;

  -- Non-disclosure: a missing record and one owned by someone else produce
  -- the identical error.
  if v_deleted_id is null then
    raise exception 'RECORD_NOT_FOUND';
  end if;

  return jsonb_build_object('outcome', 'deleted', 'id', v_deleted_id);
end;
$$;

comment on function public.delete_personal_memory_record is
  'ADR-0010 Q1: hard delete of a PersonalMemoryRecord at any status, no exceptions. Duplicate-suppression for the deleted fingerprint ends immediately -- a live partial unique index over current rows, not a separate suppression ledger.';

revoke all on function public.delete_personal_memory_record(uuid) from public;
grant execute on function public.delete_personal_memory_record(uuid) to authenticated;
