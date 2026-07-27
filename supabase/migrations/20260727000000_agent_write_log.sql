-- EPIC-07 (Write Light): durable audit trail for agent-driven GitHub writes.
-- See docs/adr/ADR-0004-write-boundaries.md.

create table if not exists public.agent_write_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  tool_id text not null check (char_length(tool_id) between 1 and 100),
  parameters jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'executed', 'failed', 'cancelled')),
  github_response jsonb
);

create index if not exists agent_write_log_user_id_created_at_idx
  on public.agent_write_log (user_id, created_at desc);

alter table public.agent_write_log enable row level security;

revoke insert, update, delete on public.agent_write_log from anon, authenticated;

grant select on public.agent_write_log to authenticated;
grant select, insert, update, delete on public.agent_write_log to service_role;

drop policy if exists "Users can read own write logs" on public.agent_write_log;
create policy "Users can read own write logs"
  on public.agent_write_log
  for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.agent_write_log is
  'Durable audit trail for agent-driven GitHub write operations (EPIC-07). Written only by the Worker via the service role; each row is scoped to the requesting user.';
