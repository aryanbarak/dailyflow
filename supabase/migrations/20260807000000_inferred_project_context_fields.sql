-- ADR-0009: Inferred Project Context Layer.
--
-- Adds the data model for LLM-derived candidate ProjectContext content --
-- the "explicit validated process" docs/architecture/project-domain.md
-- section 6 names as the precondition for LLM output to ever matter, kept
-- structurally separate from ProjectEvidence (a source observation, never a
-- conclusion) and from ProjectContext itself (which cannot be written
-- directly -- only rebuilt from inputs). Nothing in this migration touches
-- project_records, project_evidence, or project_evidence_observations.
--
-- Two tables:
--   inferred_context_derivation_runs -- one row per derivation attempt,
--     holding run-level metadata (model identity, timing, token counts,
--     outcome) per ADR-0009's Q3 resolution (minimal cost visibility, no
--     dashboard). Ordinary owner-scoped RLS; no SECURITY DEFINER needed --
--     a run record carries no evidence-linkage or authority invariant that
--     needs enforcing beyond ownership.
--   inferred_project_context_fields -- one row per candidate value for one
--     ProjectContext field (objective | milestone | decision | risk |
--     capability | candidate_action). Immutable once created, exactly like
--     ADR-0007's ProjectEvidence/ProjectEvidenceObservation: no UPDATE path
--     for authenticated at all. All writes -- both the model's original
--     proposal and every user confirm/correct/reject action -- go through
--     one of two SECURITY DEFINER functions below, which replicate every
--     ownership/project/archive/evidence-linkage check a removed INSERT
--     policy would otherwise have to express, exactly as
--     create_project_evidence_with_observation already does one layer down.

create table if not exists public.inferred_context_derivation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.project_records(id) on delete cascade,

  model_identity text not null check (char_length(model_identity) between 1 and 200),
  derivation_version text not null check (char_length(derivation_version) between 1 and 100),

  started_at timestamptz not null,
  completed_at timestamptz,

  -- ADR-0009 Q3 resolution: minimal cost visibility only -- persisted call/
  -- token counts, no cost dashboard, no currency conversion, nothing beyond
  -- what a single run result can honestly report.
  prompt_token_count integer check (prompt_token_count is null or prompt_token_count >= 0),
  response_token_count integer check (response_token_count is null or response_token_count >= 0),

  candidate_count integer not null default 0 check (candidate_count >= 0),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  dropped_count integer not null default 0 check (dropped_count >= 0),

  outcome text check (outcome is null or outcome in ('completed', 'failed')),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),

  created_at timestamptz not null default now()
);

create index if not exists inferred_context_derivation_runs_user_id_idx
  on public.inferred_context_derivation_runs (user_id);
create index if not exists inferred_context_derivation_runs_project_id_idx
  on public.inferred_context_derivation_runs (project_id);

alter table public.inferred_context_derivation_runs enable row level security;

-- A run record's own lifecycle (started -> completed, with token counts and
-- outcome filled in once the derivation finishes) is ordinary mutable
-- operational metadata, not evidence or a conclusion -- unlike
-- ProjectEvidence, there is no ADR-0007-style immutability requirement
-- here, so a normal owner-scoped UPDATE policy is sufficient; no
-- SECURITY DEFINER function is needed for this table.
drop policy if exists "Users can read own derivation runs" on public.inferred_context_derivation_runs;
create policy "Users can read own derivation runs"
  on public.inferred_context_derivation_runs
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create own derivation runs" on public.inferred_context_derivation_runs;
create policy "Users can create own derivation runs"
  on public.inferred_context_derivation_runs
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.project_records pr where pr.id = project_id and pr.user_id = auth.uid())
  );

drop policy if exists "Users can update own derivation runs" on public.inferred_context_derivation_runs;
create policy "Users can update own derivation runs"
  on public.inferred_context_derivation_runs
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.inferred_context_derivation_runs to authenticated;
grant select, insert, update, delete on public.inferred_context_derivation_runs to service_role;

comment on table public.inferred_context_derivation_runs is
  'ADR-0009: one row per Context Derivation attempt. Run-level metadata only (model identity, timing, token counts, outcome) -- never the candidate content itself, which lives in inferred_project_context_fields.';

-- ---------------------------------------------------------------------------

create table if not exists public.inferred_project_context_fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.project_records(id) on delete cascade,

  -- Nullable: required for source='model' rows (the run that produced them);
  -- always null for source='user' rows (a user correction is not itself a
  -- derivation run). Enforced by the check constraint below, not merely by
  -- convention.
  run_id uuid references public.inferred_context_derivation_runs(id) on delete cascade,

  -- Which ProjectContext field this candidate feeds
  -- (docs/architecture/project-domain.md section 8's field list). Closed
  -- enum, not an open string -- an unrecognized kind must fail closed, not
  -- silently pass through as an opaque value ProjectContextBuilder's own
  -- widened input mapping would not know how to place.
  kind text not null check (kind in ('objective', 'milestone', 'decision', 'risk', 'capability', 'candidate_action')),

  -- Structured, per-kind payload. Deterministic validation of this shape
  -- lives entirely in application code
  -- (src/features/projects/inferredProjectContextFieldValidation.ts) --
  -- this column only enforces "present and bounded," never "correctly
  -- shaped for its kind." A jsonb column cannot express a kind-conditional
  -- schema declaratively without duplicating the same per-kind rules a
  -- second time in SQL; the single source of truth is the TypeScript
  -- validator, exactly as ADR-0009's Decision section 3 states ("invalid
  -- output dropped and logged, never coerced" -- coercion is impossible if
  -- nothing downstream of validation is trusted to reshape it).
  content jsonb not null check (char_length(content::text) <= 8192),

  -- ADR-0009: "an inference with no evidence linkage is invalid by
  -- construction." Enforced here, not only in application code -- a bare
  -- empty array is rejected at the database boundary regardless of what any
  -- future call site claims. cardinality() (not array_length(), which
  -- returns null rather than 0 for an empty array) is what actually makes
  -- this constraint fire for an empty array.
  source_evidence_ids uuid[] not null check (cardinality(source_evidence_ids) >= 1 and cardinality(source_evidence_ids) <= 20),

  model_identity text not null check (char_length(model_identity) between 1 and 200),
  derivation_version text not null check (char_length(derivation_version) between 1 and 100),

  -- Closed three-value scale, not a free float (ADR-0009 Decision section
  -- 1's rationale: an LLM's self-reported numeric confidence is not a
  -- calibrated probability, and a closed enum is deterministically
  -- validatable exactly like this table family's existing closed
  -- CHECK-constrained enums, e.g. project_evidence_observations.mime_type).
  confidence text not null check (confidence in ('low', 'medium', 'high')),

  status text not null default 'proposed'
    check (status in ('proposed', 'user_confirmed', 'user_corrected', 'user_rejected', 'superseded')),

  -- 'model': the LLM's original, unmodified output -- immutable forever,
  -- exactly like ProjectEvidence. 'user': a user-authored correction row,
  -- also immutable once created (ADR-0009 Decision section 1: "Corrections
  -- create a NEW row ... THIS row's own status becomes user_corrected -- it
  -- is never edited in place").
  source text not null check (source in ('model', 'user')),

  -- Self-referencing: set on a user-authored correction to point back at
  -- the model-authored row it corrects, and set by automatic supersession
  -- (see resolve/create functions below) on the newer row replacing an
  -- older still-proposed one. Never set on the row it describes itself.
  supersedes_id uuid references public.inferred_project_context_fields(id),

  -- Deterministic SHA-256 over (project_id, kind, normalized content) --
  -- computed identically in application code
  -- (computeInferredFieldContentFingerprint in
  -- inferredProjectContextFieldValidation.ts, mirrored in the Worker's own
  -- derivation route since agent/worker cannot import frontend modules --
  -- see that Worker module's own header comment) and passed in as a
  -- parameter, exactly like project_evidence.candidate_fingerprint. Drives
  -- ADR-0009's Q1/Q5 duplicate-suppression rule, including against
  -- previously user_rejected rows.
  content_fingerprint text not null check (content_fingerprint ~ '^[0-9a-f]{64}$'),

  created_at timestamptz not null default now(),

  -- run_id required for a model row, forbidden for a user row -- the two
  -- sources have structurally different provenance and this makes the
  -- distinction unrepresentable-wrong rather than merely convention.
  constraint inferred_project_context_fields_run_id_matches_source
    check ((source = 'model' and run_id is not null) or (source = 'user' and run_id is null))
);

-- Duplicate-suppression scope: a partial unique index over non-superseded
-- rows only. A superseded row is explicitly allowed to share a fingerprint
-- with a fresh proposal again later (e.g. the same fact re-emerging after
-- being superseded and then re-confirmed independently) -- excluding
-- 'superseded' from the uniqueness scope is what makes that possible without
-- ever violating this constraint. Rows in every other status
-- (proposed/user_confirmed/user_corrected/user_rejected) remain mutually
-- exclusive on fingerprint, which is exactly ADR-0009 Q1/Q5's requirement
-- that a rejected row still suppresses a future identical re-proposal.
create unique index if not exists inferred_project_context_fields_fingerprint_key
  on public.inferred_project_context_fields (project_id, kind, content_fingerprint)
  where status <> 'superseded';

create index if not exists inferred_project_context_fields_user_id_idx
  on public.inferred_project_context_fields (user_id);
create index if not exists inferred_project_context_fields_project_id_idx
  on public.inferred_project_context_fields (project_id);
create index if not exists inferred_project_context_fields_run_id_idx
  on public.inferred_project_context_fields (run_id);
create index if not exists inferred_project_context_fields_project_kind_status_idx
  on public.inferred_project_context_fields (project_id, kind, status);

alter table public.inferred_project_context_fields enable row level security;

-- No insert/update/delete policy for authenticated at all -- exactly
-- ProjectEvidence's posture (ADR-0007). The only two write paths are the
-- SECURITY DEFINER functions below; direct client INSERT/UPDATE is revoked.
revoke insert, update, delete on public.inferred_project_context_fields from authenticated, anon;
grant select on public.inferred_project_context_fields to authenticated;
grant select, insert, update, delete on public.inferred_project_context_fields to service_role;

drop policy if exists "Users can read own inferred context fields" on public.inferred_project_context_fields;
create policy "Users can read own inferred context fields"
  on public.inferred_project_context_fields
  for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.inferred_project_context_fields is
  'ADR-0009: one row per candidate value for one ProjectContext field (objective|milestone|decision|risk|capability|candidate_action), derived by an LLM from already-persisted ProjectEvidence and never itself canonical truth. Immutable once created -- no update path, no client delete path. Writes only via create_inferred_context_field / resolve_inferred_context_field.';

-- ---------------------------------------------------------------------------
-- create_inferred_context_field: the sole path for persisting a model-
-- authored candidate. Called from the Worker's Context Derivation route
-- with the requesting user's own JWT forwarded (never service-role) so that
-- auth.uid() below resolves to the real user -- mirroring
-- create_project_evidence_with_observation's identical requirement.
-- ---------------------------------------------------------------------------
create or replace function public.create_inferred_context_field(
  p_project_id uuid,
  p_run_id uuid,
  p_kind text,
  p_content jsonb,
  p_source_evidence_ids uuid[],
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
  v_project record;
  v_run record;
  v_evidence_count integer;
  v_new_id uuid;
  v_new_row public.inferred_project_context_fields;
  v_existing public.inferred_project_context_fields;
  v_superseded_id uuid;
  v_constraint_name text;
begin
  v_owner_id := auth.uid();
  if v_owner_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  -- Project ownership + archive check -- identical non-disclosure
  -- convention as create_project_evidence_with_observation: "does not
  -- exist" and "belongs to someone else" are indistinguishable.
  select pr.status into v_project
    from public.project_records pr
    where pr.id = p_project_id and pr.user_id = v_owner_id;
  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;
  if v_project.status = 'archived' then
    raise exception 'PROJECT_ARCHIVED';
  end if;

  -- The run record must belong to this same owner and project -- a Worker
  -- bug or a forged run_id must not be able to attach a field to a run it
  -- does not own.
  select 1 into v_run
    from public.inferred_context_derivation_runs r
    where r.id = p_run_id and r.user_id = v_owner_id and r.project_id = p_project_id;
  if not found then
    raise exception 'RUN_NOT_FOUND';
  end if;

  -- ADR-0009: "an inference with no evidence linkage is invalid by
  -- construction." The column CHECK already rejects an empty array; this
  -- additionally verifies every referenced id is real evidence belonging to
  -- this exact owner and project -- the same defense-in-depth already
  -- applied to supersedes_id checks elsewhere in this schema family.
  --
  -- Deliberately scoped to project+owner membership, NOT to "was actually
  -- read by this specific run" (review finding F5/MINOR, section B7:
  -- docs/reviews/2026-08-inferred-context-layer-review.md). This function
  -- has no independent record of which evidence ids a given run's snapshot
  -- actually contained -- only the Worker route knows that (it computes the
  -- snapshot and narrows normalizeCandidate's accepted sourceEvidenceIds to
  -- exactly that set before ever calling this function;
  -- agent/worker/context-derivation-endpoint.ts's own validEvidenceIds
  -- filter is what makes "cites this run's actual evidence" true in
  -- practice today). Tightening this to true run-membership would require
  -- persisting each run's evidence-snapshot id list, a schema change with
  -- its own cost/benefit tradeoff not undertaken here -- accepted as a
  -- defense-in-depth gap, not a currently-reachable one, since the one
  -- production caller already narrows correctly one layer up.
  select count(*) into v_evidence_count
    from public.project_evidence pe
    where pe.id = any(p_source_evidence_ids) and pe.user_id = v_owner_id and pe.project_id = p_project_id;
  if v_evidence_count <> cardinality(p_source_evidence_ids) then
    raise exception 'SOURCE_EVIDENCE_NOT_FOUND';
  end if;

  -- Duplicate-suppression (ADR-0009 Q1/Q5): a non-superseded row with the
  -- identical fingerprint already exists for this project+kind -- return it
  -- rather than creating a second one. This intentionally covers
  -- user_rejected rows too (the partial unique index's own scope already
  -- excludes only 'superseded'), so a previously rejected candidate is not
  -- re-proposed merely because a new run reproduced the same content.
  --
  -- This SELECT is a fast-path optimization for the common sequential case
  -- only (skips the supersession/insert work entirely when a duplicate is
  -- already visible) -- it is NOT what makes duplicate-suppression correct
  -- under concurrency. Two concurrent calls with the identical fingerprint
  -- can both pass this check before either commits; the exception handler
  -- around the INSERT below (review finding F3;
  -- docs/reviews/2026-08-inferred-context-layer-review.md, MAJOR #2) is
  -- what makes the race itself safe, mirroring
  -- create_project_evidence_with_observation's own unique_violation handler
  -- exactly.
  select * into v_existing
    from public.inferred_project_context_fields
    where project_id = p_project_id and kind = p_kind and content_fingerprint = p_content_fingerprint
      and status <> 'superseded'
    limit 1;
  if found then
    return jsonb_build_object('outcome', 'duplicate_suppressed', 'field', to_jsonb(v_existing));
  end if;

  v_new_id := gen_random_uuid();

  -- Automatic supersession is narrow by design (ADR-0009 Decision section
  -- 1's "Automatic supersession is narrow, on purpose"): it applies only to
  -- 'objective' and 'milestone', the two kinds where ProjectContextBuilder
  -- itself enforces "at most one active" (project-domain.md section 8), and
  -- only against rows still in 'proposed' status from a DIFFERENT run --
  -- never against user_confirmed/user_corrected rows, which are
  -- user-declared state (representative-engine.md section 15) and are never
  -- silently overridden by a newer derivation. Every other kind (decision,
  -- risk, capability, candidate_action) has no single-slot exclusivity
  -- concept in ProjectContext, so multiple simultaneously-proposed
  -- candidates of those kinds are left to coexist -- automatic supersession
  -- would wrongly discard a legitimate second risk or decision candidate
  -- that has nothing to do with an earlier one.
  -- Known, accepted, out-of-scope edge case (not part of review finding F3,
  -- which is scoped to the RETURNED OUTCOME, not this): if this call goes on
  -- to lose the F3 unique_violation race below, this supersession UPDATE has
  -- already committed as part of this same call's transaction by the time
  -- the race is detected -- a losing racer's supersession side effect is not
  -- undone just because its own insert turned out to be a duplicate. This is
  -- narrower than it sounds (it only affects other, unrelated proposed rows
  -- from other runs, never the racing rows themselves) and is idempotent
  -- (superseding an already-superseded-by-the-winner row is a no-op), so it
  -- is left as-is rather than restructured here.
  if p_kind in ('objective', 'milestone') then
    select id into v_superseded_id
      from public.inferred_project_context_fields
      where project_id = p_project_id and kind = p_kind and status = 'proposed' and run_id <> p_run_id
      order by created_at desc
      limit 1;

    update public.inferred_project_context_fields
      set status = 'superseded'
      where project_id = p_project_id and kind = p_kind and status = 'proposed' and run_id <> p_run_id;
  end if;

  begin
    insert into public.inferred_project_context_fields (
      id, user_id, project_id, run_id, kind, content, source_evidence_ids,
      model_identity, derivation_version, confidence, status, source, supersedes_id, content_fingerprint
    ) values (
      v_new_id, v_owner_id, p_project_id, p_run_id, p_kind, p_content, p_source_evidence_ids,
      p_model_identity, p_derivation_version, p_confidence, 'proposed', 'model', v_superseded_id, p_content_fingerprint
    )
    returning * into v_new_row;
  exception
    when unique_violation then
      -- Review finding F3. Mirrors create_project_evidence_with_observation's
      -- own race-handling exactly: identify the ACTUAL violated constraint via
      -- the exception's own diagnostics before treating it as the benign
      -- fingerprint-duplicate case -- this table's primary key and its
      -- (id, user_id) uniqueness are also, in principle, unique constraints a
      -- future migration could add more of, and only the fingerprint index is
      -- a case this function knows how to resolve gracefully. Anything else
      -- re-raises as a real error.
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name <> 'inferred_project_context_fields_fingerprint_key' then
        raise;
      end if;

      -- Lost the race: a concurrent call with the identical
      -- (project_id, kind, content_fingerprint) committed first. This is the
      -- SAME outcome a strictly-sequential second call would have received
      -- from the SELECT check above -- never persistence_failed, never a raw
      -- error propagated to the Worker. Fail closed rather than fabricate a
      -- result if the row this violation implies exists cannot actually be
      -- found: this function's default READ COMMITTED isolation is
      -- guaranteed to see the now-committed winner, so a lookup miss here
      -- indicates a genuine inconsistency, not a timing artifact.
      select * into v_existing
        from public.inferred_project_context_fields
        where project_id = p_project_id and kind = p_kind and content_fingerprint = p_content_fingerprint
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

comment on function public.create_inferred_context_field is
  'ADR-0009: the sole path for persisting a model-authored InferredProjectContextField candidate. Must be called with the requesting user''s own JWT (never service-role) so auth.uid() resolves correctly. Handles duplicate-suppression (race-safe: a concurrent duplicate insert returns the same duplicate_suppressed outcome as a sequential one, review finding F3) and narrow automatic supersession (objective/milestone only, proposed-only) internally.';

revoke all on function public.create_inferred_context_field(
  uuid, uuid, text, jsonb, uuid[], text, text, text, text
) from public;
grant execute on function public.create_inferred_context_field(
  uuid, uuid, text, jsonb, uuid[], text, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- resolve_inferred_context_field: the sole path for a user's confirm /
-- correct / reject action on a still-proposed field. The confirm/correct
-- UI itself is out of scope for this task (ADR-0009's decision, deferred to
-- a future task) -- this function is the backend mechanism it will call,
-- built and tested now per ADR-0009's explicit instruction that status
-- transitions and the "corrections insert new rows" rule live in the
-- database function, not only in application code.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_inferred_context_field(
  p_field_id uuid,
  p_action text,
  p_corrected_content jsonb default null,
  -- Computed application-side over the same normalized shape
  -- computeInferredFieldContentFingerprint uses (SHA-256 hex), exactly like
  -- every other fingerprint in this schema family
  -- (project_evidence.candidate_fingerprint,
  -- inferred_project_context_fields.content_fingerprint on the create
  -- path) -- Postgres core has no SHA-256 without the pgcrypto extension,
  -- and this migration deliberately does not add that dependency, exactly
  -- as the ADR-0007 migration already decided for the identical reason.
  p_corrected_content_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_field public.inferred_project_context_fields;
  v_new_id uuid;
  v_new_row public.inferred_project_context_fields;
begin
  v_owner_id := auth.uid();
  if v_owner_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_action not in ('confirm', 'correct', 'reject') then
    raise exception 'UNSUPPORTED_ACTION';
  end if;

  -- Non-disclosure: a missing field and one owned by someone else produce
  -- the identical error.
  select * into v_field
    from public.inferred_project_context_fields
    where id = p_field_id and user_id = v_owner_id;
  if not found then
    raise exception 'FIELD_NOT_FOUND';
  end if;

  -- Only a still-proposed field can be resolved. A field already
  -- confirmed/corrected/rejected/superseded is not re-actionable through
  -- this function -- there is no "un-confirm" or "un-reject" in ADR-0009's
  -- state machine.
  if v_field.status <> 'proposed' then
    raise exception 'FIELD_NOT_PROPOSED';
  end if;

  if p_action = 'confirm' then
    update public.inferred_project_context_fields set status = 'user_confirmed' where id = p_field_id;
    select * into v_field from public.inferred_project_context_fields where id = p_field_id;
    return jsonb_build_object('outcome', 'user_confirmed', 'field', to_jsonb(v_field));
  end if;

  if p_action = 'reject' then
    update public.inferred_project_context_fields set status = 'user_rejected' where id = p_field_id;
    select * into v_field from public.inferred_project_context_fields where id = p_field_id;
    return jsonb_build_object('outcome', 'user_rejected', 'field', to_jsonb(v_field));
  end if;

  -- p_action = 'correct': the original model row's own status becomes
  -- user_corrected -- it is never edited in place. A NEW row is inserted
  -- with source='user', supersedes_id pointing back at the original, and
  -- status='user_confirmed' directly -- a user-authored correction is
  -- itself an affirmative user declaration, not a pending proposal
  -- (ADR-0009 Decision section 1). confidence is fixed at 'high': a
  -- user-declared value is not a model confidence estimate at all.
  if p_corrected_content is null or jsonb_typeof(p_corrected_content) <> 'object' then
    raise exception 'INVALID_CORRECTED_CONTENT';
  end if;
  if char_length(p_corrected_content::text) > 8192 then
    raise exception 'INVALID_CORRECTED_CONTENT';
  end if;
  if p_corrected_content_fingerprint is null or p_corrected_content_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_CORRECTED_CONTENT';
  end if;

  update public.inferred_project_context_fields set status = 'user_corrected' where id = p_field_id;

  -- User corrections are exempted from the duplicate-suppression this
  -- function's sibling create path applies -- a user is always entitled to
  -- declare their own correction even if it happens to match something
  -- already proposed. The partial unique index still applies to this
  -- INSERT as ordinary defense (no row, from any source, may share a
  -- fingerprint with a non-superseded row of the same project+kind), and a
  -- collision here deliberately raises a raw unique_violation to the
  -- caller rather than being caught and reinterpreted as "already applied"
  -- (review finding F3; docs/reviews/2026-08-inferred-context-layer-review.md,
  -- MAJOR #2 -- an earlier version of this comment claimed the caller could
  -- treat it that way, which the repository never actually implemented).
  -- Unlike create_inferred_context_field's duplicate-suppression, where
  -- "same project+kind+fingerprint, from ANY source" is deliberately the
  -- whole point (Q1/Q5: a rejected model candidate must still suppress a
  -- reappearing one), a collision on THIS insert is ambiguous: it could be
  -- the exact same correction request replayed (genuinely "already
  -- applied"), or it could be an unrelated existing row that merely
  -- happens to share this project+kind+fingerprint (a different candidate
  -- entirely, e.g. a still-proposed model candidate with byte-identical
  -- content). Gracefully returning "the existing row" without
  -- distinguishing those two cases would risk reporting outcome
  -- 'user_corrected' for a row that is not this user's correction at all
  -- (wrong source, wrong status) -- a worse failure mode than the current
  -- loud, honest error. Failing loudly here is therefore the deliberate,
  -- lower-risk choice, not an oversight.
  v_new_id := gen_random_uuid();
  insert into public.inferred_project_context_fields (
    id, user_id, project_id, run_id, kind, content, source_evidence_ids,
    model_identity, derivation_version, confidence, status, source, supersedes_id, content_fingerprint
  ) values (
    v_new_id, v_owner_id, v_field.project_id, null, v_field.kind, p_corrected_content, v_field.source_evidence_ids,
    'user', 'user-correction-v1', 'high', 'user_confirmed', 'user', p_field_id, p_corrected_content_fingerprint
  )
  returning * into v_new_row;

  return jsonb_build_object('outcome', 'user_corrected', 'field', to_jsonb(v_new_row));
end;
$$;

comment on function public.resolve_inferred_context_field is
  'ADR-0009: the sole path for a user confirm/correct/reject action on a proposed InferredProjectContextField. A correction never mutates the original row''s content -- it inserts a new source=user row and marks the original user_corrected.';

revoke all on function public.resolve_inferred_context_field(uuid, text, jsonb, text) from public;
grant execute on function public.resolve_inferred_context_field(uuid, text, jsonb, text) to authenticated;
