-- Document-Sourced Memory slice 2 (task 18), Phase B3: supersession
-- semantics for personal_memory_records.
--
-- Three NEW nullable columns, three distinct relationships -- deliberately
-- kept separate rather than overloaded onto the existing supersedes_id
-- column's original meaning:
--
--   possible_update_of_id -- set by create_personal_memory_record (Worker,
--     Phase B1) when propose-time overlap detection finds an existing
--     record this NEW candidate might be an update to. A SUGGESTION only --
--     never itself changes any other row's status. Self-referencing,
--     ON DELETE SET NULL (the suggestion simply stops pointing anywhere if
--     its target is later deleted -- not an error, not resurrected).
--
--   superseded_by_id + superseded_at -- set TOGETHER, ONLY by the new
--     confirm_personal_memory_record_update RPC below, when a user
--     EXPLICITLY confirms a candidate as an update to this record ("no
--     silent supersession" -- PO decision). superseded_by_id is
--     ON DELETE SET NULL: if the superseding record is later hard-deleted
--     (ADR-0010 Q1, unconditional), this row does NOT resurrect -- it
--     stays status='superseded' (invisible to consumption, same as
--     before), just with unknown-who-superseded-it lineage, exactly
--     mirroring supersedes_id's own already-accepted "lineage may be lost
--     on delete" precedent (20260808000000_personal_memory_records.sql's
--     own comment on that column). superseded_at is NEVER touched by any
--     FK action (no ON DELETE clause references it), so "WHEN it was
--     superseded" survives permanently even if "BY WHICH record" becomes
--     unknown -- this is why the CHECK constraint below only ties status
--     to superseded_at, never to superseded_by_id.
--
-- create_personal_memory_record is extended (10th parameter,
-- p_possible_update_of_id) rather than replaced with a same-arity
-- CREATE OR REPLACE, since Postgres treats a changed parameter list as a
-- different function identity -- the grant below re-targets the new
-- 10-argument signature explicitly.
--
-- confirm_personal_memory_record_update is a NEW, fourth SECURITY DEFINER
-- function (no ADR-0009/ADR-0010 analogue) -- atomic in the same sense
-- create_personal_memory_record already is: both the candidate's
-- confirmation AND the target's supersession happen inside one function
-- body, so a client can never observe a state where only one of the two
-- happened.
--
-- Idempotent throughout; safe to re-run. NOT applied by this task -- see
-- the task 18 final report: "PRODUCTION MIGRATION READY -- PO
-- AUTHORIZATION REQUIRED".

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.personal_memory_records
  add column if not exists possible_update_of_id uuid references public.personal_memory_records(id) on delete set null;

alter table public.personal_memory_records
  add column if not exists superseded_by_id uuid references public.personal_memory_records(id) on delete set null;

alter table public.personal_memory_records
  add column if not exists superseded_at timestamptz;

-- A record is status='superseded' if and only if superseded_at is set --
-- deliberately NOT superseded_by_id (see header comment: that column can
-- legitimately become null via ON DELETE SET NULL while status correctly
-- remains 'superseded' forever).
alter table public.personal_memory_records
  drop constraint if exists personal_memory_records_superseded_at_matches_status;
alter table public.personal_memory_records
  add constraint personal_memory_records_superseded_at_matches_status
  check ((status = 'superseded') = (superseded_at is not null));

create index if not exists personal_memory_records_possible_update_of_id_idx
  on public.personal_memory_records (possible_update_of_id) where possible_update_of_id is not null;
create index if not exists personal_memory_records_superseded_by_id_idx
  on public.personal_memory_records (superseded_by_id) where superseded_by_id is not null;

comment on column public.personal_memory_records.possible_update_of_id is
  'Task 18 B1: propose-time overlap-detection SUGGESTION only (set by create_personal_memory_record). Never itself causes supersession -- see superseded_by_id/superseded_at for the actual event, which only ever happens via an explicit user Confirm through confirm_personal_memory_record_update.';
comment on column public.personal_memory_records.superseded_by_id is
  'Task 18 B3: the record that superseded this one, IF that record still exists (ON DELETE SET NULL -- lineage may be lost on delete, mirrors supersedes_id). Set only by confirm_personal_memory_record_update, atomically with status=''superseded''.';
comment on column public.personal_memory_records.superseded_at is
  'Task 18 B3: WHEN this record was superseded -- permanent once set, never nulled by any FK action, unlike superseded_by_id. The authoritative signal for status=''superseded'' (see this table''s own CHECK constraint).';

-- ---------------------------------------------------------------------------
-- create_personal_memory_record: extended with a 10th parameter,
-- p_possible_update_of_id (default null, so every EXISTING call site
-- -- chat/briefing/document candidates with no detected overlap -- keeps
-- working unchanged). When provided, verified to belong to the SAME user
-- AND the SAME kind before being stored (defense in depth, mirroring this
-- function's own existing ref-id membership checks) -- a mismatched or
-- forged value is silently ignored (stored as null) rather than raising,
-- since this is a non-authoritative suggestion, not a security boundary
-- the caller depends on.
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
  p_content_fingerprint text,
  p_possible_update_of_id uuid default null
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
  v_update_target public.personal_memory_records;
  v_possible_update_of_id uuid;
begin
  v_owner_id := auth.uid();
  if v_owner_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select 1 into v_run
    from public.personal_memory_extraction_runs r
    where r.id = p_run_id and r.user_id = v_owner_id;
  if not found then
    raise exception 'RUN_NOT_FOUND';
  end if;

  if p_provenance_source_kind not in ('chat_turn', 'briefing', 'document') then
    raise exception 'UNSUPPORTED_PROVENANCE_SOURCE_KIND';
  end if;

  if p_provenance_source_kind = 'chat_turn' then
    select count(*) into v_ref_count
      from public.agent_chat_messages m
      where m.id = any(p_provenance_source_ref_ids) and m.user_id = v_owner_id;
  elsif p_provenance_source_kind = 'document' then
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

  -- Task 18 B1: verify the suggested overlap target belongs to this same
  -- user AND shares this candidate's kind -- silently dropped (stored
  -- null), not rejected, if either check fails. This is a UI hint, not an
  -- authority boundary; failing the whole candidate over a bad hint would
  -- be the wrong failure mode.
  v_possible_update_of_id := null;
  if p_possible_update_of_id is not null then
    select * into v_update_target
      from public.personal_memory_records
      where id = p_possible_update_of_id and user_id = v_owner_id and kind = p_kind;
    if found then
      v_possible_update_of_id := p_possible_update_of_id;
    end if;
  end if;

  select * into v_existing
    from public.personal_memory_records
    where user_id = v_owner_id and kind = p_kind and content_fingerprint = p_content_fingerprint
      and status <> 'superseded'
    limit 1;
  if found then
    return jsonb_build_object('outcome', 'duplicate_suppressed', 'field', to_jsonb(v_existing));
  end if;

  v_new_id := gen_random_uuid();

  begin
    insert into public.personal_memory_records (
      id, user_id, run_id, kind, content, provenance_source_kind, provenance_source_ref_ids,
      model_identity, derivation_version, confidence, status, source, supersedes_id, content_fingerprint,
      possible_update_of_id
    ) values (
      v_new_id, v_owner_id, p_run_id, p_kind, p_content, p_provenance_source_kind, p_provenance_source_ref_ids,
      p_model_identity, p_derivation_version, p_confidence, 'proposed', 'model', null, p_content_fingerprint,
      v_possible_update_of_id
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

comment on function public.create_personal_memory_record(uuid, text, jsonb, text, uuid[], text, text, text, text, uuid) is
  'ADR-0010 + task 16 + task 18 B1: the sole path for persisting a model-authored PersonalMemoryRecord candidate, now optionally carrying a propose-time overlap SUGGESTION (possible_update_of_id). Must be called with the requesting user''s own JWT (never service-role). Race-safe duplicate-suppression built in from the start.';

revoke all on function public.create_personal_memory_record(
  uuid, text, jsonb, text, uuid[], text, text, text, text, uuid
) from public;
grant execute on function public.create_personal_memory_record(
  uuid, text, jsonb, text, uuid[], text, text, text, text, uuid
) to authenticated;

-- The old 9-argument signature no longer has any caller (the Worker route
-- is updated in this same task to always pass the 10th argument, even if
-- null) -- dropped so exactly one create_personal_memory_record signature
-- exists, avoiding a confusing overload where an old cached PostgREST
-- schema cache entry could route to either.
drop function if exists public.create_personal_memory_record(
  uuid, text, jsonb, text, uuid[], text, text, text, text
);

-- ---------------------------------------------------------------------------
-- confirm_personal_memory_record_update: the sole path for a user
-- confirming that a still-proposed candidate is an UPDATE to a different,
-- existing record (task 18 B2/B3) -- atomic: the candidate's own
-- confirmation and the target's supersession happen in one transaction,
-- so a client can never observe one without the other.
--
-- Reuses supersedes_id (not a new column) on the CANDIDATE row to record
-- "this confirmed record replaced that one" -- the exact same meaning
-- resolve_personal_memory_record's own 'correct' branch already gives that
-- column, just reached via a different path (an update confirmation
-- instead of a content correction). This is deliberate reuse, not
-- coincidence: it means PersonalMemorySection's existing "view original /
-- previous version" affordance (keyed off supersedes_id) works for BOTH
-- cases with no new UI-side lineage concept.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_personal_memory_record_update(
  p_candidate_record_id uuid,
  p_superseded_record_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_candidate public.personal_memory_records;
  v_target public.personal_memory_records;
  v_now timestamptz;
  v_new_candidate public.personal_memory_records;
  v_new_target public.personal_memory_records;
begin
  v_owner_id := auth.uid();
  if v_owner_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_candidate_record_id = p_superseded_record_id then
    raise exception 'INVALID_SUPERSESSION_PAIR';
  end if;

  -- Non-disclosure: a missing/foreign record and a real-but-wrong-status
  -- one produce distinguishable errors from EACH OTHER (matching
  -- resolve_personal_memory_record's own precedent) but neither ever
  -- reveals whether a record exists for a DIFFERENT user.
  select * into v_candidate
    from public.personal_memory_records
    where id = p_candidate_record_id and user_id = v_owner_id;
  if not found then
    raise exception 'CANDIDATE_NOT_FOUND';
  end if;
  if v_candidate.status <> 'proposed' then
    raise exception 'CANDIDATE_NOT_PROPOSED';
  end if;

  select * into v_target
    from public.personal_memory_records
    where id = p_superseded_record_id and user_id = v_owner_id;
  if not found then
    raise exception 'SUPERSEDED_RECORD_NOT_FOUND';
  end if;
  -- Cannot supersede a row that's already superseded (no chained/double
  -- supersession in v1) or already deleted (RECORD_NOT_FOUND above already
  -- covers "gone entirely"). A rejected or still-proposed target CAN be
  -- superseded -- both are live rows a user might reasonably want this
  -- confirmed candidate to replace.
  if v_target.status = 'superseded' then
    raise exception 'RECORD_ALREADY_SUPERSEDED';
  end if;
  if v_target.kind <> v_candidate.kind then
    raise exception 'KIND_MISMATCH';
  end if;

  v_now := now();

  update public.personal_memory_records
    set status = 'user_confirmed', supersedes_id = p_superseded_record_id
    where id = p_candidate_record_id
    returning * into v_new_candidate;

  update public.personal_memory_records
    set status = 'superseded', superseded_by_id = p_candidate_record_id, superseded_at = v_now
    where id = p_superseded_record_id
    returning * into v_new_target;

  return jsonb_build_object(
    'outcome', 'update_confirmed',
    'candidate', to_jsonb(v_new_candidate),
    'superseded', to_jsonb(v_new_target)
  );
end;
$$;

comment on function public.confirm_personal_memory_record_update is
  'Task 18 B2/B3: the sole path for confirming a proposed candidate as an update to a different existing record. Atomic (one function body, one transaction): the candidate becomes user_confirmed (supersedes_id = the target) and the target becomes superseded (superseded_by_id/superseded_at = this candidate/now) together, or neither happens. No silent supersession -- this function is only ever called on an explicit user action, never automatically.';

revoke all on function public.confirm_personal_memory_record_update(uuid, uuid) from public;
grant execute on function public.confirm_personal_memory_record_update(uuid, uuid) to authenticated;
