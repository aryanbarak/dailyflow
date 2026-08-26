-- ENG-04: pending/claimed/completed engineering-task queue backing the
-- companion's outbound polling loop. See docs/architecture/notes/
-- eng-04-companion-chat-approval-wiring-v1.md.
--
-- AUTHORED ONLY -- do not apply to production without PO authorization
-- ("برو") -- Tier-1 per ADR-0008: schema/migration change.
--
-- Same trust shape as agent_code_proposal_approvals (20260728000000): the
-- Worker (service_role) owns every insert and status transition; the
-- browser never writes this table directly, only reads its own rows. A
-- companion polling for work is NOT a Supabase-authenticated user -- it
-- authenticates to the Worker with a separate shared secret
-- (ENGINEERING_TASKS_COMPANION_TOKEN, a Worker secret) -- so there is no
-- RLS policy for "the companion"; the Worker's own service-role writes are
-- the only path that ever claims or completes a row.

create table if not exists public.engineering_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  repo text not null check (char_length(repo) between 1 and 200),
  instruction text not null check (char_length(instruction) between 1 and 4000),
  -- Logged only in this slice (ENG-04 Part 2 item 3) -- no auto/ask/off
  -- policy branches on this value yet; that is explicitly deferred to a
  -- future ADR-0012 extension (see the referenced note, Part 4).
  task_class text not null check (char_length(task_class) between 1 and 100),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  -- Informational only (which companion instance picked this up) -- never
  -- used as an authorization fact; the shared secret is what authorizes the
  -- claim/report calls, not this value.
  claimed_by text,
  completed_at timestamptz,
  branch_name text,
  -- Advisory only, exactly as ENG-03 established -- never treated as
  -- runtime truth by anything that reads this row.
  self_report jsonb,
  -- Ground truth, independently derived by the companion from git/GitHub
  -- (ENG-03's verify.js), per authority-model.md's "audit MUST NOT be
  -- fabricated from model claims" -- this is the field chat actually
  -- surfaces to the user, not self_report.
  verified_result jsonb,
  disagreement jsonb,
  error_message text,
  constraint engineering_tasks_claimed_fields_together
    check ((claimed_at is null) = (claimed_by is null)),
  constraint engineering_tasks_completed_after_claimed
    check (completed_at is null or claimed_at is not null)
);

create index if not exists engineering_tasks_pending_order_idx
  on public.engineering_tasks (created_at asc)
  where status = 'pending';

create index if not exists engineering_tasks_user_id_idx
  on public.engineering_tasks (user_id, created_at desc);

alter table public.engineering_tasks enable row level security;

revoke insert, update, delete on public.engineering_tasks from anon, authenticated;
grant select on public.engineering_tasks to authenticated;
grant select, insert, update, delete on public.engineering_tasks to service_role;

drop policy if exists "Users can read own engineering tasks" on public.engineering_tasks;
create policy "Users can read own engineering tasks"
  on public.engineering_tasks
  for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.engineering_tasks is
  'ENG-04: pending/claimed/completed engineering-task queue. Created by the Worker (service_role) after an approved chat proposal, claimed by the companion''s outbound poll (never pushed to), reported back by the companion, read by the owning user only. No auto/ask/off policy branching in this slice -- task_class is logged only.';

-- Atomic job-claim: SELECT ... FOR UPDATE SKIP LOCKED + UPDATE in one
-- round trip, so two concurrent poll cycles (or, in a future multi-
-- companion world, two different companions) can never both claim the
-- same row -- the standard Postgres job-queue pattern, chosen over a plain
-- two-step SELECT-then-UPDATE specifically to make the race structurally
-- impossible rather than merely unlikely (mirrors ADR-0005 Decision 9's
-- "atomic conditional update... requiring exactly one row affected", here
-- done in a single function instead of the Worker issuing two sequential
-- HTTP calls to PostgREST with a race window between them).
create or replace function public.claim_pending_engineering_task(p_claimed_by text)
returns setof public.engineering_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.engineering_tasks
  where status = 'pending'
  order by created_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  return query
  update public.engineering_tasks
  set status = 'claimed', claimed_at = now(), claimed_by = p_claimed_by
  where id = v_id
  returning *;
end;
$$;

revoke all on function public.claim_pending_engineering_task(text) from public, anon, authenticated;
grant execute on function public.claim_pending_engineering_task(text) to service_role;

comment on function public.claim_pending_engineering_task(text) is
  'ENG-04: atomically claims the oldest pending engineering_tasks row (FOR UPDATE SKIP LOCKED), so concurrent poll cycles can never double-claim the same task. Returns zero rows if nothing is pending. service_role only -- called by the Worker on the companion''s behalf after verifying the shared companion token, never callable directly by anon/authenticated.';
