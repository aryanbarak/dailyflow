-- Slice 4B: ProjectEvidence Foundation.
-- Durable, immutable, owner- and project-scoped evidence observations only.
-- See docs/architecture/project-domain.md section 6 and
-- docs/architecture/project-evidence-acquisition.md sections 6-14 for the
-- canonical definition this table implements: a traceable, provenance-
-- carrying observation, not a conclusion, not ProjectContext, not
-- execution authority, and not a provider credential. This slice performs
-- no source acquisition -- callers submit an already-formed evidence
-- candidate (as a future Evidence Source Adapter would), and this table
-- durably stores it. There is no update path and no client delete path:
-- ProjectEvidence is immutable once created (project-evidence-acquisition.md
-- section 14); a correction or newer observation is always a new row.

create table if not exists public.project_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.project_records(id) on delete cascade,

  -- Mirrors ProjectSourceKind (projectContextTypes.ts) exactly -- the same
  -- closed set already whitelisted as ProjectRecord evidence-source
  -- *configuration* in the Slice 3 migration. An unsupported kind fails
  -- closed instead of being coerced.
  source_kind text not null check (source_kind in (
    'repository_document',
    'architecture_document',
    'adr',
    'roadmap_document',
    'product_direction_document',
    'project_status_document',
    'verified_repository_state',
    'verified_integration_evidence'
  )),

  -- Non-ordinal classification (project-evidence-acquisition.md section 12).
  -- Deliberately excludes derived/llm_inferred/generated/rejected/
  -- accepted_execution_result -- none of those are valid ProjectEvidence
  -- categories under current architecture.
  classification text not null check (classification in (
    'observed',
    'explicit_user_statement',
    'imported',
    'verified_provider_observation',
    'canonical_document_observation'
  )),

  title text not null check (char_length(title) between 1 and 200),
  reference text not null check (char_length(reference) between 1 and 500),

  -- When the source was observed to contain this. Immutable once set --
  -- there is no freshness field here; freshness is a consumption-time
  -- computation owned by the future Context Rebuild service, never a stored
  -- or mutable column (project-evidence-acquisition.md section 19).
  collected_at timestamptz not null,

  adapter_identity text not null check (char_length(adapter_identity) between 1 and 200),
  adapter_version text not null check (char_length(adapter_version) between 1 and 100),
  verification_method text not null check (char_length(verification_method) between 1 and 200),

  source_revision text check (source_revision is null or char_length(source_revision) between 1 and 200),
  confidence real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  uncertainty text check (uncertainty is null or char_length(uncertainty) between 1 and 500),
  notes text check (notes is null or char_length(notes) <= 2000),

  -- Supersession is explicit and append-only: this column is the only
  -- reference between two evidence rows, it is set once at creation, and it
  -- is never updated. `on delete set null` rather than cascade: if a
  -- superseded row is ever removed by a service-role/admin operation, the
  -- superseding row remains valid evidence in its own right.
  supersedes_id uuid references public.project_evidence(id) on delete set null,

  -- Opaque caller-supplied identifier for the acquisition attempt that
  -- produced this candidate. Not a foreign key -- acquisition attempts are
  -- not persisted by this slice.
  acquisition_attempt_id text check (acquisition_attempt_id is null or char_length(acquisition_attempt_id) between 1 and 200),

  -- Application-computed digest over the fields that identify "the same
  -- exact evidence candidate" (project id, source kind, reference,
  -- collected_at, adapter identity/version). Paired with the unique index
  -- below, this rejects an accidental duplicate resubmission of the
  -- identical candidate while still allowing a legitimate re-observation of
  -- the same source at a different time (a different collected_at yields a
  -- different fingerprint). Slice-local duplicate prevention, not a
  -- canonical identity scheme.
  candidate_fingerprint text not null check (char_length(candidate_fingerprint) = 64),

  created_at timestamptz not null default now()
);

create unique index if not exists project_evidence_candidate_fingerprint_key
  on public.project_evidence (project_id, candidate_fingerprint);

create index if not exists project_evidence_user_id_idx
  on public.project_evidence (user_id);

create index if not exists project_evidence_project_id_idx
  on public.project_evidence (project_id);

create index if not exists project_evidence_supersedes_id_idx
  on public.project_evidence (supersedes_id);

alter table public.project_evidence enable row level security;

-- No update path and no client delete path at all in this slice: neither
-- grant includes `update` or `delete` for authenticated/anon, and no
-- update/delete policy is defined below. service_role keeps full access for
-- operational/admin use only.
revoke update, delete on public.project_evidence from authenticated, anon;
grant select, insert on public.project_evidence to authenticated;
grant select, insert, update, delete on public.project_evidence to service_role;

drop policy if exists "Users can read own project evidence" on public.project_evidence;
create policy "Users can read own project evidence"
  on public.project_evidence
  for select
  to authenticated
  using (auth.uid() = user_id);

-- The insert policy enforces both that the row's own user_id matches the
-- authenticated caller AND that the referenced project actually belongs to
-- that same caller -- defense in depth against a spoofed cross-owner
-- project_id, independent of and in addition to the application-layer
-- ownership check in projectEvidenceService.ts.
--
-- It also enforces that, when supersedes_id is set, the referenced evidence
-- row belongs to the same owner AND the same project as the row being
-- inserted -- the same defense-in-depth reasoning applied to supersession:
-- projectEvidenceService.ts already verifies this before calling insert, but
-- a client that bypasses the service and calls the Supabase REST API
-- directly must still be unable to create a cross-project or cross-owner
-- supersession edge, since RLS, not application code, is this table's
-- actual security boundary.
--
-- The subquery aliases the referenced row as `pe`. Inside that subquery's
-- own scope, an unqualified column name resolves to `pe`'s column first if
-- one exists with that name -- the bare table name `project_evidence` must
-- be used explicitly to reach the row being inserted instead. This applies
-- to every column shared between `pe` and the outer row, not just the one
-- being compared last: both `project_evidence.supersedes_id` (the id being
-- looked up) and `project_evidence.project_id` (the project being checked)
-- must be qualified this way. An unqualified `supersedes_id` here would
-- instead resolve to `pe.supersedes_id`, silently checking whether the
-- referenced row supersedes itself -- a condition that is essentially never
-- true -- and would deny every legitimate supersession. An unqualified
-- `project_id` would likewise resolve to `pe.project_id`, silently
-- comparing that column to itself and always passing.
drop policy if exists "Users can create own project evidence" on public.project_evidence;
create policy "Users can create own project evidence"
  on public.project_evidence
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.project_records pr
      where pr.id = project_id and pr.user_id = auth.uid()
    )
    and (
      supersedes_id is null
      or exists (
        select 1
        from public.project_evidence pe
        where pe.id = project_evidence.supersedes_id
          and pe.user_id = auth.uid()
          and pe.project_id = project_evidence.project_id
      )
    )
  );

comment on table public.project_evidence is
  'ProjectEvidence (docs/architecture/project-evidence-acquisition.md): durable, immutable, owner- and project-scoped evidence observations only. No ProjectContext-derived field, no approval/execution field, no provider credential, no source content blob. Immutable once created -- no update path, no client delete path. This slice performs no source acquisition.';
