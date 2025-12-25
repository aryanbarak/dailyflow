drop table if exists public.user_api_keys cascade;

create table public.user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service_name text not null,
  ciphertext_b64 text not null,
  iv_b64 text not null,
  is_valid boolean,
  last_validated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, service_name)
);

alter table public.user_api_keys enable row level security;

create policy "select_own_keys"
on public.user_api_keys for select
to authenticated
using (auth.uid() = user_id);

create policy "insert_own_keys"
on public.user_api_keys for insert
to authenticated
with check (auth.uid() = user_id);

create policy "update_own_keys"
on public.user_api_keys for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "delete_own_keys"
on public.user_api_keys for delete
to authenticated
using (auth.uid() = user_id);
