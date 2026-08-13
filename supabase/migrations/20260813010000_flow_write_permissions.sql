-- ADR-0012: Write Capability Layer v1.
-- Authored only. Do not apply to production without PO authorization.

create table if not exists public.flow_write_permissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  action text not null,
  mode text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint flow_write_permissions_pkey primary key (user_id, domain, action),
  constraint flow_write_permissions_domain_action_nonempty check (
    length(btrim(domain)) > 0 and length(btrim(action)) > 0
  ),
  constraint flow_write_permissions_mode_check check (mode in ('auto', 'ask', 'off'))
);

alter table public.flow_write_permissions enable row level security;

drop policy if exists "Users can read own flow write permissions" on public.flow_write_permissions;
create policy "Users can read own flow write permissions"
on public.flow_write_permissions
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own flow write permissions" on public.flow_write_permissions;
create policy "Users can insert own flow write permissions"
on public.flow_write_permissions
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own flow write permissions" on public.flow_write_permissions;
create policy "Users can update own flow write permissions"
on public.flow_write_permissions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.set_flow_write_permissions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists flow_write_permissions_updated_at on public.flow_write_permissions;
create trigger flow_write_permissions_updated_at
before update on public.flow_write_permissions
for each row
execute function public.set_flow_write_permissions_updated_at();

create table if not exists public.flow_write_undo_records (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  task_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint flow_write_undo_records_kind_check check (kind in ('create_task', 'update_task')),
  constraint flow_write_undo_records_payload_object_check check (jsonb_typeof(payload) = 'object')
);

create index if not exists flow_write_undo_records_user_expires_idx
  on public.flow_write_undo_records (user_id, expires_at desc);

alter table public.flow_write_undo_records enable row level security;

revoke insert, update, delete on public.flow_write_undo_records from anon, authenticated;
grant select on public.flow_write_undo_records to authenticated;
grant select, insert, update, delete on public.flow_write_undo_records to service_role;

drop policy if exists "Users can read own flow write undo records" on public.flow_write_undo_records;
create policy "Users can read own flow write undo records"
on public.flow_write_undo_records
for select
to authenticated
using (auth.uid() = user_id);
