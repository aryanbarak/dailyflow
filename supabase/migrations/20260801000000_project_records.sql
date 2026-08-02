-- Slice 3: ProjectRecord Foundation.
-- Durable, editable, owner-scoped project identity and configuration only.
-- See docs/architecture/project-domain.md sections 5 and 12 for the
-- canonical field ownership this table implements: identity, lifecycle,
-- repository binding *configuration* (not connection status), and enabled
-- evidence-source *configuration* (not acquired evidence). No ProjectContext
-- field, no execution/approval field, and no provider credential is stored
-- here.

create table if not exists public.project_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Only Software Project is implemented (docs/product/product-direction-v1.md
  -- section 3). Widening this later is a migration, not a silent runtime
  -- default, so an unsupported type fails closed instead of being coerced.
  project_type text not null check (project_type = 'software_project'),

  name text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),

  -- Closed lifecycle. Deliberately not the ProjectContext milestone/objective
  -- status vocabulary (project-domain.md section 4's "Project lifecycle" vs
  -- "ProjectContext-derived state" distinction).
  status text not null default 'active' check (status in ('active', 'archived')),

  -- Repository binding configuration only -- provider-extensible (widen the
  -- check constraint when a second provider is implemented), never a
  -- connection-status, credential, or verified-evidence field. All three
  -- columns are null together or present together.
  repo_provider text check (repo_provider is null or repo_provider = 'github'),
  repo_owner text check (repo_owner is null or char_length(repo_owner) between 1 and 200),
  repo_name text check (repo_name is null or char_length(repo_name) between 1 and 200),
  constraint project_records_repo_binding_all_or_none check (
    (repo_provider is null and repo_owner is null and repo_name is null)
    or (repo_provider is not null and repo_owner is not null and repo_name is not null)
  ),

  -- Which ProjectSourceKind categories (projectContextTypes.ts) are enabled
  -- for this project. Configuration only: enabling a kind does not acquire,
  -- verify, or fetch any evidence, and this slice never populates evidence.
  enabled_evidence_source_kinds text[] not null default '{}',
  constraint project_records_evidence_source_kinds_known check (
    enabled_evidence_source_kinds <@ array[
      'repository_document',
      'architecture_document',
      'adr',
      'roadmap_document',
      'product_direction_document',
      'project_status_document',
      'verified_repository_state',
      'verified_integration_evidence'
    ]::text[]
  ),

  -- Optimistic concurrency: every update must supply the version it read and
  -- is conditioned on it at the database level (application update statement
  -- includes `where version = :expectedVersion`), so a stale write fails
  -- explicitly instead of silently overwriting a newer one.
  version integer not null default 1 check (version >= 1),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active project per owner may bind to a given repository. Archived
-- projects are excluded so an archived project's old binding never blocks a
-- new active project from reusing it.
create unique index if not exists project_records_active_repo_binding_key
  on public.project_records (user_id, repo_provider, repo_owner, repo_name)
  where status = 'active' and repo_provider is not null;

create index if not exists project_records_user_id_idx
  on public.project_records (user_id);

alter table public.project_records enable row level security;

-- No hard delete from the client in this slice (Slice 3 explicitly does not
-- implement delete). service_role keeps full access for operational/admin
-- use; RLS still applies to every role that is not exempted by Postgres
-- (service_role is exempted by Supabase's standard `bypassrls` role grant).
revoke delete on public.project_records from authenticated, anon;
grant select, insert, update on public.project_records to authenticated;
grant select, insert, update, delete on public.project_records to service_role;

drop policy if exists "Users can read own project records" on public.project_records;
create policy "Users can read own project records"
  on public.project_records
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create own project records" on public.project_records;
create policy "Users can create own project records"
  on public.project_records
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own project records" on public.project_records;
create policy "Users can update own project records"
  on public.project_records
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists update_project_records_updated_at on public.project_records;
create trigger update_project_records_updated_at
before update on public.project_records
for each row execute function public.update_updated_at_column();

comment on table public.project_records is
  'ProjectRecord (docs/architecture/project-domain.md): durable, owner-editable project identity and configuration only. No ProjectContext-derived field, no approval/execution field, no provider credential. Repository binding and evidence-source fields are configuration, not verified evidence or connection status.';
