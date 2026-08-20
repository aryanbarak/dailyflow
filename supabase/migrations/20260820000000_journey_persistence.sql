-- MB-19, ADR-0015 §14: Orb Journey persistence -- two tables, two distinct
-- write patterns, per the concept doc's original design (see ADR-0015 §14
-- for the full write-timing rationale). This migration creates the FILE
-- only -- it is not applied to any database as part of MB-19 (Tier-1,
-- requires explicit PO "برو" before `supabase db push`/`migration up`).

-- journey_progress: one row per user, UPDATABLE (a checkpoint, not a
-- history) -- mirrors this project's project_records.sql convention (a
-- single-row-per-owner mutable record, per-operation RLS policies, no
-- blanket "for all" policy). user_id IS the primary key -- there is
-- structurally never more than one row per user, so a separate synthetic
-- id column would only invite a spurious extra unique constraint.
create table if not exists public.journey_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- Room indices are 1-based throughout Orb Journey (roomEngine.ts's own
  -- convention) -- 0 is never a valid room, so the floor is 1, not 0.
  farthest_room integer not null default 1 check (farthest_room >= 1),
  best_total_score integer not null default 0 check (best_total_score >= 0),
  rooms_discovered_count integer not null default 0 check (rooms_discovered_count >= 0),

  -- Achievement/unlock map, shape owned entirely by the client (this
  -- migration does not constrain its internal structure) -- defaults to an
  -- empty object, never null, so callers never need a null-check before
  -- reading into it.
  constellation_state jsonb not null default '{}'::jsonb,

  updated_at timestamptz not null default now()
);

alter table public.journey_progress enable row level security;

-- Explicit, no "ALL" policy -- ADR-0014 §6's own stated convention, and
-- matches project_records.sql's per-operation shape. DELETE is included
-- (unlike project_records, which has none this slice) per ADR-0015 §14's
-- explicit citation of this project's standing user-data-ownership
-- principle (ADR-0014 §6: "append-only constrains the app's write
-- pattern, not the user's right to erase their own data" -- journey_progress
-- isn't even append-only, so the same right applies at least as strongly).
grant select, insert, update, delete on public.journey_progress to authenticated;
grant select, insert, update, delete on public.journey_progress to service_role;

drop policy if exists "Users can read own journey progress" on public.journey_progress;
create policy "Users can read own journey progress"
  on public.journey_progress
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create own journey progress" on public.journey_progress;
create policy "Users can create own journey progress"
  on public.journey_progress
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own journey progress" on public.journey_progress;
create policy "Users can update own journey progress"
  on public.journey_progress
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own journey progress" on public.journey_progress;
create policy "Users can delete own journey progress"
  on public.journey_progress
  for delete
  to authenticated
  using (auth.uid() = user_id);

drop trigger if exists update_journey_progress_updated_at on public.journey_progress;
create trigger update_journey_progress_updated_at
before update on public.journey_progress
for each row execute function public.update_updated_at_column();

comment on table public.journey_progress is
  'ADR-0015 §14: Orb Journey checkpoint, one row per user. Updated (never appended) whenever a completed room exceeds farthest_room or a session score beats best_total_score. Not a session history -- see journey_runs for that.';

-- journey_runs: append-only session log -- ADR-0014 §6's micro_break_sessions
-- idempotency pattern (id generated CLIENT-SIDE via crypto.randomUUID() at
-- session end, all persistence retries reuse the same id, insert uses
-- on conflict (id) do nothing so a retried write after a network failure is
-- a safe no-op rather than a duplicate row). No default on id: the client
-- MUST always supply it -- a server-generated default would defeat the
-- whole idempotent-retry design (two different ids for the same logical
-- session on retry).
create table if not exists public.journey_runs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ended_at_room integer not null check (ended_at_room >= 1),
  total_score integer not null check (total_score >= 0),
  created_at timestamptz not null default now()
);

create index if not exists journey_runs_user_id_idx
  on public.journey_runs (user_id);

alter table public.journey_runs enable row level security;

-- SELECT/INSERT/DELETE only -- explicitly NO update policy or grant. The
-- app never updates a run once written (same append-only trust model as
-- ADR-0014 §6's micro_break_sessions: "UPDATE: no policy -- the app never
-- updates a row"). Mirrors project_records.sql's own `revoke ... from
-- authenticated, anon` pattern, applied to UPDATE here instead of DELETE.
revoke update on public.journey_runs from authenticated, anon;
grant select, insert, delete on public.journey_runs to authenticated;
grant select, insert, update, delete on public.journey_runs to service_role;

drop policy if exists "Users can read own journey runs" on public.journey_runs;
create policy "Users can read own journey runs"
  on public.journey_runs
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create own journey runs" on public.journey_runs;
create policy "Users can create own journey runs"
  on public.journey_runs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own journey runs" on public.journey_runs;
create policy "Users can delete own journey runs"
  on public.journey_runs
  for delete
  to authenticated
  using (auth.uid() = user_id);

comment on table public.journey_runs is
  'ADR-0015 §14: Orb Journey append-only session log. id is CLIENT-generated (crypto.randomUUID()) for idempotent retry via on conflict (id) do nothing -- same pattern as ADR-0014 §6''s micro_break_sessions. No UPDATE policy by design: the app never updates a written run.';
