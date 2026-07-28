-- EPIC-08 Slice 3: server-verifiable approval artifact for code-write
-- proposals. See docs/adr/ADR-0005-code-write-mutation-boundary.md.

create table if not exists public.agent_code_proposal_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  proposal_id text not null check (char_length(proposal_id) between 1 and 200),
  repo text not null check (char_length(repo) between 1 and 200),
  path text not null check (char_length(path) between 1 and 400),
  base_blob_sha text not null check (char_length(base_blob_sha) between 1 and 64),
  base_commit_sha text not null check (char_length(base_commit_sha) between 1 and 64),
  proposed_content_digest text not null check (char_length(proposed_content_digest) = 64),
  risk_level text not null check (risk_level in ('none', 'low', 'medium', 'high')),
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint agent_code_proposal_approvals_expiry_after_approval check (expires_at > approved_at)
);

-- Supports both the mutation route's unconsumed-approval lookup and the
-- atomic claim's WHERE clause (user_id + proposal_id + consumed_at IS NULL).
create index if not exists agent_code_proposal_approvals_lookup_idx
  on public.agent_code_proposal_approvals (user_id, proposal_id)
  where consumed_at is null;

alter table public.agent_code_proposal_approvals enable row level security;

revoke insert, update, delete on public.agent_code_proposal_approvals from anon, authenticated;

grant select on public.agent_code_proposal_approvals to authenticated;
grant select, insert, update, delete on public.agent_code_proposal_approvals to service_role;

drop policy if exists "Users can read own code proposal approvals" on public.agent_code_proposal_approvals;
create policy "Users can read own code proposal approvals"
  on public.agent_code_proposal_approvals
  for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.agent_code_proposal_approvals is
  'Server-verifiable, single-use approval record for EPIC-08 code-write proposals (ADR-0005). Written only by the Worker via the service role, after independently re-deriving every stored fact from GitHub; never trusts browser-supplied base SHAs, digest, or risk level. Rows are consumed exactly once, by an atomic conditional update, immediately before a GitHub mutation is attempted. No secrets or raw proposed file content are stored -- only identifiers and a content digest.';
