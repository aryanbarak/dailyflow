-- ADR-0007: ProjectEvidence Observation Model.
--
-- Adds the immutable, 1:1 `project_evidence_observations` aggregate that
-- owns the consumable payload ProjectEvidence itself deliberately does not
-- (docs/decisions/adr/ADR-0007-projectevidence-observation-model.md). The
-- first implementation supports a bounded UTF-8 text payload only -- no
-- structured JSON, no binary/artifact reference, no object storage.
--
-- This migration also corrects a real defect confirmed by independent
-- review of the uncommitted Repository Documents Adapter: the existing
-- `candidate_fingerprint` (20260802000000_project_evidence.sql) includes
-- `collected_at`, so two concurrent acquisitions of byte-identical content
-- compute different fingerprints and both succeed, defeating duplicate
-- detection under concurrency. From this migration forward, the
-- application-computed `candidate_fingerprint` passed into
-- `create_project_evidence_with_observation` below is based on content
-- identity (project, source kind, reference, content hash, adapter
-- identity/version), never `collected_at`. No existing row's stored
-- `candidate_fingerprint` value is rewritten by this migration: existing
-- rows keep whatever value they were inserted with, and the unique index
-- continues to enforce uniqueness on whatever value is present regardless
-- of which formula produced it -- old-formula and new-formula rows do not
-- conflict with each other, so no backfill or data rewrite is needed or
-- performed. Accepted, narrow consequence of not rewriting: a post-
-- migration re-acquisition of content identical to a row that was already
-- stored under the old, collected_at-inclusive formula will not match that
-- row's stored fingerprint, so it creates one new pair rather than
-- returning "unchanged" -- a one-time miss per pre-migration row, not a
-- repeatable one, since the new-formula fingerprint then governs dedup for
-- that content going forward. No backfill has been performed to close this
-- gap.
--
-- Because ADR-0007 requires "no orphan ProjectEvidence row may exist" and
-- "no orphan observation row may exist," direct client INSERT into
-- `project_evidence` is removed by this migration: the only INSERT path for
-- either table, from this point on, is the `SECURITY DEFINER` function
-- below, which creates both rows in one real database transaction (a single
-- function invocation is one atomic Postgres transaction) or creates
-- neither. Reads are unaffected -- both tables keep owner-scoped SELECT via
-- RLS exactly as before.

-- Required before project_evidence_observations below, so it can declare a
-- composite foreign key that also pins project_id/user_id to the referenced
-- evidence row's own values (id is already unique via the primary key; this
-- composite unique constraint is what makes that FK possible).
alter table public.project_evidence
  add constraint project_evidence_id_project_id_user_id_key unique (id, project_id, user_id);

create table if not exists public.project_evidence_observations (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.project_records(id) on delete cascade,

  -- Closed to 'text' only in this implementation (ADR-0007). Widening this
  -- to a second payload kind (structured JSON, an artifact reference) is a
  -- future migration, not a silent runtime default.
  payload_kind text not null check (payload_kind = 'text'),

  -- Bounded UTF-8 text only. 512 KiB matches
  -- repositoryDocumentFileReader.ts's own MAX_DOCUMENT_BYTES read ceiling --
  -- the two are deliberately kept equal rather than two independently
  -- chosen numbers, since nothing the adapter would even read can exceed
  -- this bound.
  text_content text not null check (char_length(text_content) >= 1),
  mime_type text not null check (mime_type in ('text/markdown', 'text/plain')),
  byte_length integer not null check (byte_length > 0 and byte_length <= 524288),

  -- Enforced against the actual persisted text, not merely trusted from the
  -- caller -- a byte_length that does not match octet_length(text_content)
  -- can never be inserted, regardless of what any future call site claims.
  constraint project_evidence_observations_byte_length_matches
    check (byte_length = octet_length(text_content)),

  -- SHA-256 of the exact UTF-8 bytes represented by text_content, lowercase
  -- hex. Correctness against text_content itself is an application-layer
  -- guarantee (the service always computes this from the given text, never
  -- accepts a caller-supplied value) rather than a database-enforced one --
  -- Postgres core has no SHA-256 without the pgcrypto extension, and this
  -- migration deliberately does not add that dependency for one column.
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),

  -- Optional, structured provenance -- never free text. Replaces the
  -- `notes`-embedded "git-revision:<sha>" convention used experimentally in
  -- the pre-ADR-0007 Repository Documents Adapter diff.
  git_revision text check (git_revision is null or git_revision ~ '^[0-9a-f]{40}$'),

  created_at timestamptz not null default now(),

  -- Owner/project consistency, enforced declaratively: this row's
  -- project_id and user_id must match the referenced project_evidence row's
  -- own project_id and user_id, not just be independently valid values. See
  -- the matching unique constraint added to project_evidence below.
  foreign key (evidence_id, project_id, user_id)
    references public.project_evidence (id, project_id, user_id)
    on delete cascade
);

create index if not exists project_evidence_observations_user_id_idx
  on public.project_evidence_observations (user_id);

create index if not exists project_evidence_observations_project_id_idx
  on public.project_evidence_observations (project_id);

alter table public.project_evidence_observations enable row level security;

-- No insert/update/delete policy for authenticated/anon at all: the only
-- insert path is the SECURITY DEFINER function below, which is not subject
-- to RLS on this table (it runs as the function owner) but replicates the
-- equivalent ownership checks in its own body before it ever inserts.
-- service_role keeps full access for operational/admin use only.
revoke insert, update, delete on public.project_evidence_observations from authenticated, anon;
grant select on public.project_evidence_observations to authenticated;
grant select, insert, update, delete on public.project_evidence_observations to service_role;

drop policy if exists "Users can read own project evidence observations" on public.project_evidence_observations;
create policy "Users can read own project evidence observations"
  on public.project_evidence_observations
  for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.project_evidence_observations is
  'ProjectEvidenceObservation (ADR-0007): the immutable, 1:1 consumable-payload aggregate for ProjectEvidence. Text payload only in this implementation -- no structured JSON, no binary/artifact reference, no object storage. Not ProjectContext, not interpretation, not execution authority, not memory truth. Immutable once created -- no update path, no client delete path.';

-- Direct client INSERT into project_evidence is removed: from this
-- migration forward, every ProjectEvidence row must be created together
-- with its ProjectEvidenceObservation via create_project_evidence_with_observation
-- below, so no path can ever produce a "hash-only" evidence row with no
-- observation again.
drop policy if exists "Users can create own project evidence" on public.project_evidence;
revoke insert on public.project_evidence from authenticated;

create or replace function public.create_project_evidence_with_observation(
  p_project_id uuid,
  p_source_kind text,
  p_classification text,
  p_title text,
  p_reference text,
  p_collected_at timestamptz,
  p_adapter_identity text,
  p_adapter_version text,
  p_verification_method text,
  p_candidate_fingerprint text,
  p_text_content text,
  p_mime_type text,
  p_byte_length integer,
  p_content_hash text,
  p_git_revision text default null,
  p_source_revision text default null,
  p_confidence real default null,
  p_uncertainty text default null,
  p_notes text default null,
  p_supersedes_id uuid default null,
  p_acquisition_attempt_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_project record;
  v_evidence_id uuid;
  v_observation_id uuid;
  v_constraint_name text;
  v_existing_evidence public.project_evidence;
  v_existing_observation public.project_evidence_observations;
  v_new_evidence public.project_evidence;
  v_new_observation public.project_evidence_observations;
begin
  -- Trusted owner resolution: never accepted as a parameter, always the
  -- authenticated caller's own session -- mirroring every other
  -- ProjectEvidence/ProjectRecord write path in this codebase.
  v_owner_id := auth.uid();
  if v_owner_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  -- Project ownership, archive, and enabled-kind checks -- one query, so
  -- "does not exist" and "belongs to someone else" are indistinguishable to
  -- the caller (non-disclosure, matching projectEvidenceService.ts's
  -- existing convention).
  select pr.status, pr.enabled_evidence_source_kinds
    into v_project
    from public.project_records pr
    where pr.id = p_project_id
      and pr.user_id = v_owner_id;

  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if v_project.status = 'archived' then
    raise exception 'PROJECT_ARCHIVED';
  end if;

  if not (p_source_kind = any(v_project.enabled_evidence_source_kinds)) then
    raise exception 'SOURCE_KIND_NOT_ENABLED';
  end if;

  -- Supersession ownership/project scope -- identical rule to
  -- projectEvidenceService.ts's own check and to the (now-removed) INSERT
  -- policy's supersession subquery: the referenced row must exist, belong
  -- to this owner, and belong to this same project, or the create fails
  -- with the same error regardless of which of those three is false.
  if p_supersedes_id is not null then
    if not exists (
      select 1 from public.project_evidence pe
      where pe.id = p_supersedes_id
        and pe.user_id = v_owner_id
        and pe.project_id = p_project_id
    ) then
      raise exception 'SUPERSEDED_EVIDENCE_NOT_FOUND';
    end if;
  end if;

  v_evidence_id := gen_random_uuid();

  begin
    insert into public.project_evidence (
      id, user_id, project_id, source_kind, classification, title, reference,
      collected_at, adapter_identity, adapter_version, verification_method,
      source_revision, confidence, uncertainty, notes, supersedes_id,
      acquisition_attempt_id, candidate_fingerprint
    ) values (
      v_evidence_id, v_owner_id, p_project_id, p_source_kind, p_classification, p_title, p_reference,
      p_collected_at, p_adapter_identity, p_adapter_version, p_verification_method,
      p_source_revision, p_confidence, p_uncertainty, p_notes, p_supersedes_id,
      p_acquisition_attempt_id, p_candidate_fingerprint
    )
    returning * into v_new_evidence;
  exception
    when unique_violation then
      -- Not every unique_violation on this insert is the content-identity
      -- fingerprint collision this function knows how to resolve
      -- gracefully -- the table also carries a primary key and the
      -- id/project_id/user_id composite unique constraint (both keyed off
      -- a freshly generated id, so a real collision there is not expected,
      -- but "not expected" is not "impossible", and a future migration
      -- could add another unique constraint on this table). Identify the
      -- actual violated constraint via the exception's own diagnostics
      -- rather than assuming, and re-raise anything that is not the one
      -- constraint this branch is written to handle -- an unrelated
      -- integrity failure must surface as a real error, never be
      -- misreported as a benign "unchanged" outcome.
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name <> 'project_evidence_candidate_fingerprint_key' then
        raise;
      end if;

      -- A row with this exact content-identity fingerprint already exists
      -- for this project: this is the corrected, content-hash-based
      -- duplicate/unchanged path (see the migration header comment), never
      -- an error surfaced to the caller. No second observation is ever
      -- created for it. This is also what makes two concurrent identical
      -- acquisitions safe: whichever transaction's INSERT commits first
      -- wins, and the other observes unique_violation here instead of
      -- creating a second pair. The lookup is scoped to this same owner,
      -- not just this project, as belt-and-suspenders -- project_id alone
      -- already pins a single owner via project_records, but the explicit
      -- filter costs nothing and removes any doubt.
      select * into v_existing_evidence
        from public.project_evidence
        where project_id = p_project_id
          and candidate_fingerprint = p_candidate_fingerprint
          and user_id = v_owner_id
        limit 1;

      -- Fail closed rather than returning a fabricated pair: a
      -- unique_violation on this exact constraint means the conflicting
      -- row was already committed by whichever transaction won the race
      -- (that is what raised the violation in the first place), and this
      -- function's default READ COMMITTED isolation is guaranteed to see
      -- any already-committed row -- so failing to find it here indicates
      -- a genuine inconsistency this function must not paper over.
      if v_existing_evidence.id is null then
        raise exception 'EVIDENCE_CONFLICT_LOOKUP_FAILED';
      end if;

      select * into v_existing_observation
        from public.project_evidence_observations
        where evidence_id = v_existing_evidence.id
          and user_id = v_owner_id
          and project_id = p_project_id
        limit 1;

      -- Every ProjectEvidence row is created atomically with its
      -- observation (ADR-0007) -- an evidence row with no paired
      -- observation is never a legitimate "unchanged" candidate, and
      -- returning one anyway (with a null-filled observation) would be
      -- exactly the "metadata-only evidence" state this whole slice exists
      -- to make impossible. Fail closed instead.
      if v_existing_observation.id is null then
        raise exception 'EVIDENCE_MISSING_OBSERVATION';
      end if;

      return jsonb_build_object(
        'outcome', 'unchanged',
        'evidence', to_jsonb(v_existing_evidence),
        'observation', to_jsonb(v_existing_observation)
      );
  end;

  -- No exception block around this insert: any failure here (a check
  -- constraint violation, for example) propagates out of the function
  -- uncaught, which rolls back the entire function invocation -- including
  -- the project_evidence insert above -- since a single function call is
  -- one Postgres transaction. This is what guarantees "no orphan
  -- ProjectEvidence row" without any explicit ROLLBACK statement.
  v_observation_id := gen_random_uuid();
  insert into public.project_evidence_observations (
    id, evidence_id, user_id, project_id, payload_kind, text_content,
    mime_type, byte_length, content_hash, git_revision
  ) values (
    v_observation_id, v_evidence_id, v_owner_id, p_project_id, 'text', p_text_content,
    p_mime_type, p_byte_length, p_content_hash, p_git_revision
  )
  returning * into v_new_observation;

  return jsonb_build_object(
    'outcome', 'created',
    'evidence', to_jsonb(v_new_evidence),
    'observation', to_jsonb(v_new_observation)
  );
end;
$$;

comment on function public.create_project_evidence_with_observation is
  'ADR-0007: the sole write path for ProjectEvidence and its ProjectEvidenceObservation. SECURITY DEFINER because authenticated no longer holds direct INSERT on either table -- every ownership/project/archive/enabled-kind/supersession check the removed INSERT policies used to perform is replicated in this function''s own body instead of relied on via RLS.';

revoke all on function public.create_project_evidence_with_observation(
  uuid, text, text, text, text, timestamptz, text, text, text, text, text, text, integer, text, text, text, real, text, text, uuid, text
) from public;
grant execute on function public.create_project_evidence_with_observation(
  uuid, text, text, text, text, timestamptz, text, text, text, text, text, text, integer, text, text, text, real, text, text, uuid, text
) to authenticated;
